import GObject from "gi://GObject";
import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import {
  closeCard,
  fetchBoardLists,
  fetchAvailableLists,
  validateBoardAccess,
  matchesGlobPattern,
} from "./trello.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

// Settings schema
const SCHEMA_NAME = "org.gnome.shell.extensions.trello-cards";

let timeout;

const TrelloCardsMainIndicator = GObject.registerClass(
  class TrelloCardsMainIndicator extends PanelMenu.Button {
    constructor(settings) {
      super(0.0, "Trello Cards Extension");

      this._settings = settings;

      // Create the panel button with extension icon
      this.buttonText = new St.Label({
        text: "🃏",
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.add_child(this.buttonText);

      // Add settings menu item
      let settingsMenuItem = new PopupMenu.PopupMenuItem("Settings");
      settingsMenuItem.connect("activate", () => {
        this._openPreferences();
      });
      this.menu.addMenuItem(settingsMenuItem);

      // Add refresh all menu item
      let refreshMenuItem = new PopupMenu.PopupMenuItem("Refresh All Lists");
      refreshMenuItem.connect("activate", () => {
        this._refreshAllLists();
        if (this._refreshCallback) {
          this._refreshCallback();
        }
      });
      this.menu.addMenuItem(refreshMenuItem);

      // Add status info
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this._statusItem = new PopupMenu.PopupMenuItem("Status: Ready");
      this.menu.addMenuItem(this._statusItem);
    }

    _openPreferences() {
      try {
        const proc = Gio.Subprocess.new(
          [
            "gnome-extensions",
            "prefs",
            "trello-cards@michaelaquilina.github.io",
          ],
          Gio.SubprocessFlags.NONE,
        );
      } catch (e) {
        console.error(e);
      }
    }

    _refreshAllLists() {
      // This will be called by the main extension to refresh all list indicators
      this._statusItem.label.text = "Status: Refreshing...";
      // The actual refresh logic will be handled by the main extension
    }

    setRefreshCallback(callback) {
      this._refreshCallback = callback;
    }

    updateStatus(message) {
      this._statusItem.label.text = `Status: ${message}`;
    }
  },
);

const TrelloCardsIndicator = GObject.registerClass(
  class TrelloCardsIndicator extends PanelMenu.Button {
    constructor(settings, listConfig) {
      super(0.0, `Trello Cards - ${listConfig.listName}`);

      this._settings = settings;
      this._listConfig = listConfig;
      this._boardName = null; // Will be fetched asynchronously

      // Fetch board name and initial load
      this._fetchBoardName()
        .then(() => {
          // Create the panel button
          this.buttonText = new St.Label({
            text: this._getButtonText(),
            y_align: Clutter.ActorAlign.CENTER,
          });

          this.add_child(this.buttonText);

          let headerItem = new PopupMenu.PopupMenuItem(
            `${this._boardName} - ${listConfig.listName}`,
            {
              reactive: false,
              can_focus: false,
            },
          );

          // Style it as a header
          headerItem.label.style_class = "popup-header";
          this.menu.addMenuItem(headerItem);

          // Create menu section for cards
          this.cardsSection = new PopupMenu.PopupMenuSection();
          this.menu.addMenuItem(this.cardsSection);

          // make sure its always up to date when clicked
          this.connect("button-press-event", () => {
            this.refreshCards();
          });

          this.refreshCards();
        })
        .catch((error) => {
          console.error("Failed to fetch board name:", error);
          this.refreshCards(); // Still load cards even if board name fetch fails
        });
    }

    async _fetchBoardName() {
      try {
        const apiKey = this._settings.get_string("api-key");
        const token = this._settings.get_string("token");

        if (!apiKey || !token) {
          console.warn("No API credentials available for board name fetch");
          return;
        }

        const boardId = this.getBoardId();
        if (!boardId) {
          console.warn("No board ID available for board name fetch");
          return;
        }

        const boardInfo = await validateBoardAccess(boardId, apiKey, token);
        this._boardName = boardInfo.name;
        console.log(`Successfully fetched board name: ${this._boardName}`);
      } catch (error) {
        console.error("Failed to fetch board name:", error);
        // Keep _boardName as null, will fall back to default behavior
      }
    }

    createCard(list) {
      console.log("Creating new card");
      const boardName = this._boardName;
      const command = [
        "kitty",
        "-e",
        "zsh",
        "-l",
        "-c",
        `EDITOR=nvim tro create "${boardName}" "${list.name}" -s`,
      ];
      console.log("Running command", command);
      Gio.Subprocess.new(command, Gio.SubprocessFlags.NONE);
    }

    _getButtonText(cardCount = null) {
      const showNames = this._settings.get_boolean("show-list-names");
      const showEmojis = this._settings.get_boolean("show-emojis");
      const showCount = this._settings.get_boolean("show-card-count");

      let parts = [];

      if (showEmojis) {
        parts.push(this._listConfig.emoji || "📋");
      }

      if (showNames) {
        const name = this._listConfig.listName;
        const displayName = name.length > 8 ? name.substring(0, 8) + "…" : name;
        parts.push(displayName);
      }

      let text = parts.join(" ");

      if (showCount && cardCount !== null) {
        text += ` (${cardCount})`;
      }

      // Fallback if nothing is enabled
      if (!showEmojis && !showNames) {
        text = this._listConfig.emoji || "📋";
      }

      return text;
    }

    getBoardId() {
      const boardUrlRegex = /https:\/\/trello\.com\/b\/([a-zA-Z0-9]+)(?:\/|\b)/;

      // Use the list-specific board ID (required)
      const boardId = this._listConfig.boardId;

      if (!boardId) {
        throw new Error(
          `Missing board ID for list: ${this._listConfig.listName}`,
        );
      }

      const match = boardId.match(boardUrlRegex);
      if (match) {
        return match[1];
      } else {
        return boardId;
      }
    }

    refreshCards() {
      this.cardsSection.removeAll();

      // Add a loading indicator
      let loadingItem = new PopupMenu.PopupMenuItem("Loading cards...");
      this.cardsSection.addMenuItem(loadingItem);

      const apiKey = this._settings.get_string("api-key");
      const token = this._settings.get_string("token");

      let boardId;
      try {
        boardId = this.getBoardId();
      } catch (error) {
        this.cardsSection.removeAll();
        let errorItem = new PopupMenu.PopupMenuItem(
          `Config Error: ${error.message}`,
        );
        this.cardsSection.addMenuItem(errorItem);
        console.error(
          `Configuration error for list "${this._listConfig.listName}":`,
          error,
        );
        return;
      }

      if (!apiKey || !token) {
        this.cardsSection.removeAll();
        let errorItem = new PopupMenu.PopupMenuItem("Missing API credentials");
        this.cardsSection.addMenuItem(errorItem);
        console.error("Missing API credentials - check extension settings");
        return;
      }

      console.log(
        `Refreshing cards for list "${this._listConfig.listName}" on board ${boardId}`,
      );

      fetchBoardLists(boardId, apiKey, token)
        .then((lists) => {
          // Remove loading indicator
          this.cardsSection.removeAll();

          if (!lists || lists.length === 0) {
            let noListsItem = new PopupMenu.PopupMenuItem(
              "No lists found on board",
            );
            this.cardsSection.addMenuItem(noListsItem);
            console.warn(`No lists found on board ${boardId}`);
            return;
          }

          let cardCount = 0;
          let targetListFound = false;

          for (const list of lists) {
            // Filter by the specific list name/pattern for this indicator
            if (!matchesGlobPattern(list.name, this._listConfig.listName)) {
              continue;
            }

            targetListFound = true;
            const cards = list.cards;
            cardCount += cards.length;

            console.log(
              `Found matching list "${list.name}" (pattern: "${this._listConfig.listName}") with ${cards.length} cards`,
            );

            // Add cards to the menu
            cards.forEach((card) => {
              let cardItem = new PopupMenu.PopupMenuItem(card.name);
              let buttonBox = new St.BoxLayout({
                style_class: "card-buttons",
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
              });

              const closeButton = new St.Button({
                style_class: "button",
                label: "Close",
                x_expand: true,
              });
              closeButton.connect("clicked", async () => {
                try {
                  await closeCard(card.id, apiKey, token);
                  this.refreshCards();
                } catch (error) {
                  console.error(`Failed to close card ${card.name}:`, error);
                }
              });

              buttonBox.add_child(closeButton);
              cardItem.add_child(buttonBox);

              // Open card in browser when clicked
              cardItem.connect("activate", () => {
                const boardName = this._boardName;
                Gio.Subprocess.new(
                  [
                    "kitty",
                    "-e",
                    "zsh",
                    "-l",
                    "-c",
                    `EDITOR=nvim tro show "${boardName}" "${list.name}" "${card.name}"`,
                  ],
                  Gio.SubprocessFlags.NONE,
                );
              });

              this.cardsSection.addMenuItem(cardItem);
            });

            this.cardsSection.addMenuItem(
              new PopupMenu.PopupSeparatorMenuItem(),
            );
            let createMenuItem = new PopupMenu.PopupMenuItem("Create New");
            createMenuItem.connect("activate", () => {
              this.createCard(list);
              this.refreshCards();
            });
            this.cardsSection.addMenuItem(createMenuItem);
          }

          if (!targetListFound) {
            // List pattern not found - show error and available lists
            console.error(
              `No lists match pattern "${this._listConfig.listName}" on board ${boardId}`,
            );
            let errorItem = new PopupMenu.PopupMenuItem(
              `No lists match pattern "${this._listConfig.listName}"`,
            );
            this.cardsSection.addMenuItem(errorItem);

            let patternHelpItem = new PopupMenu.PopupMenuItem(
              "Pattern examples: *Today*, 📅*, *Progress*",
            );
            this.cardsSection.addMenuItem(patternHelpItem);

            let availableListsItem = new PopupMenu.PopupMenuItem(
              "Available lists:",
            );
            this.cardsSection.addMenuItem(availableListsItem);

            lists.forEach((list) => {
              let listItem = new PopupMenu.PopupMenuItem(`  • ${list.name}`);
              this.cardsSection.addMenuItem(listItem);
            });

            console.log(
              `No lists match pattern "${this._listConfig.listName}" on board ${boardId}`,
            );
            console.log(
              `Available lists on board ${boardId}:`,
              lists.map((l) => `"${l.name}"`).join(", "),
            );
          }

          // Update the button text with card count if enabled
          this.buttonText.set_text(this._getButtonText(cardCount));
        })
        .catch((error) => {
          console.error(
            `Failed to refresh cards for list "${this._listConfig.listName}":`,
            error,
          );
          this.cardsSection.removeAll();

          let errorItem = new PopupMenu.PopupMenuItem(
            `Error: ${error.message}`,
          );
          this.cardsSection.addMenuItem(errorItem);

          // Try to get available lists to help with debugging
          if (
            error.message.includes("HTTP 404") ||
            error.message.includes("invalid")
          ) {
            console.log("Attempting to fetch available lists for debugging...");
            fetchAvailableLists(boardId, apiKey, token)
              .then((availableLists) => {
                console.log(
                  "Available lists for debugging:",
                  availableLists.map((l) => `"${l.name}"`).join(", "),
                );
              })
              .catch((debugError) => {
                console.error(
                  "Could not fetch available lists for debugging:",
                  debugError.message,
                );
              });
          }
        });
    }
  },
);

export default class TrelloCardsExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    this._mainIndicator = null;
    this._indicators = [];
    this._settingsChangedId = null;
  }

  enable() {
    console.log(`Enabling ${this.metadata.name}`);

    this._settings = this.getSettings(SCHEMA_NAME);

    // Create main extension indicator
    this._mainIndicator = new TrelloCardsMainIndicator(this._settings);
    Main.panel.addToStatusArea(
      "trello-cards-main",
      this._mainIndicator,
      1,
      this._getPanelPosition(),
    );

    // Set up refresh callback for main indicator
    this._mainIndicator.setRefreshCallback(() => {
      this._refreshAllListIndicators();
    });

    // Create indicators for each target list
    this._createIndicators();

    // Set up the refresh timer
    this._setupTimer();

    // Connect to settings changes
    this._settingsChangedId = this._settings.connect("changed", () => {
      // Recreate indicators if target lists changed
      this._createIndicators();

      // Reset the timer with new interval
      this._setupTimer();
    });
  }

  disable() {
    console.log(`Disabling ${this.metadata.name}`);

    // Destroy main indicator
    if (this._mainIndicator) {
      this._mainIndicator.destroy();
      this._mainIndicator = null;
    }

    // Destroy all list indicators
    this._destroyIndicators();

    if (timeout) {
      GLib.source_remove(timeout);
      timeout = null;
    }

    // Disconnect from settings
    if (this._settings && this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = null;
    }
  }

  _getTargetListsConfig() {
    try {
      const configStr = this._settings.get_string("target-lists-config");
      const config = JSON.parse(configStr);
      return config || [];
    } catch (e) {
      console.error("Error parsing target lists config:", e);
      // Return empty configuration
      return [];
    }
  }

  _getPanelPosition() {
    let [position] = this._settings.get_value("panel-position").get_string();
    return position;
  }

  _createIndicators() {
    // Destroy existing indicators first
    this._destroyIndicators();

    // Get target lists configuration from settings
    const targetListsConfig = this._getTargetListsConfig();

    // If no lists configured, skip creating indicators
    if (targetListsConfig.length === 0) {
      console.log("No target lists configured");
      if (this._mainIndicator) {
        this._mainIndicator.updateStatus("No lists configured");
      }
      return;
    }

    let position = this._getPanelPosition();

    // Create an indicator for each target list
    targetListsConfig.forEach((listConfig, index) => {
      try {
        const indicator = new TrelloCardsIndicator(this._settings, listConfig);
        const statusAreaName =
          index === 0 ? "trello-cards" : `trello-cards-${index}`;
        Main.panel.addToStatusArea(statusAreaName, indicator, 1, position);
        this._indicators.push(indicator);
      } catch (error) {
        console.error(
          `Failed to create indicator for list ${listConfig.listName}:`,
          error,
        );
      }
    });

    // Update main indicator status
    if (this._mainIndicator) {
      this._mainIndicator.updateStatus(
        `${this._indicators.length} lists configured`,
      );
    }
  }

  _destroyIndicators() {
    // Destroy all existing indicators
    this._indicators.forEach((indicator) => {
      if (indicator) {
        indicator.destroy();
      }
    });
    this._indicators = [];
  }

  _refreshAllListIndicators() {
    this._mainIndicator.updateStatus("Refreshing...");

    let refreshCount = 0;
    let errorCount = 0;
    const totalIndicators = this._indicators.length;

    if (totalIndicators === 0) {
      this._mainIndicator.updateStatus("No lists configured");
      return;
    }

    const refreshPromises = this._indicators.map((indicator) => {
      if (indicator) {
        return new Promise((resolve) => {
          try {
            indicator.refreshCards();
            refreshCount++;
            console.log(
              `Successfully refreshed: ${indicator._listConfig.listName}`,
            );
            resolve("success");
          } catch (error) {
            errorCount++;
            console.error(
              `Failed to refresh ${indicator._listConfig.listName}:`,
              error,
            );
            resolve("error");
          }
        });
      }
      return Promise.resolve("skipped");
    });

    Promise.all(refreshPromises).then(() => {
      let statusMessage;
      if (errorCount === 0) {
        statusMessage = `${refreshCount} lists refreshed`;
      } else if (refreshCount === 0) {
        statusMessage = `All ${errorCount} lists failed`;
      } else {
        statusMessage = `${refreshCount} refreshed, ${errorCount} failed`;
      }

      setTimeout(() => {
        this._mainIndicator.updateStatus(statusMessage);
      }, 1500);
    });
  }

  _setupTimer() {
    // Clear any existing timer
    if (timeout) {
      GLib.source_remove(timeout);
      timeout = null;
    }

    // Get refresh interval from settings (convert to seconds)
    const refreshInterval = this._settings.get_int("refresh-interval") * 60;

    // Create a new timer to refresh cards periodically
    timeout = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      refreshInterval,
      () => {
        // Refresh all indicators
        this._refreshAllListIndicators();
        return GLib.SOURCE_CONTINUE; // Continue the timer
      },
    );
  }
}
