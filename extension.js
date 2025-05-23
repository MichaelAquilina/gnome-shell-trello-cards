import GObject from "gi://GObject";
import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";

import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import { closeCard, fetchBoardLists } from "./trello.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

// Settings schema
const SCHEMA_NAME = "org.gnome.shell.extensions.trello-cards";

let timeout;

const TrelloCardsIndicator = GObject.registerClass(
  class TrelloCardsIndicator extends PanelMenu.Button {
    constructor(settings) {
      super(0.0, "Trello Cards");

      this._settings = settings;

      // Create the panel button with an icon
      this.buttonText = new St.Label({
        text: "🃏",
        y_align: Clutter.ActorAlign.CENTER,
      });

      this.add_child(this.buttonText);

      // Create menu section for cards
      this.cardsSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this.cardsSection);

      // Add settings menu item
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      let settingsMenuItem = new PopupMenu.PopupMenuItem("Settings");
      settingsMenuItem.connect("activate", () => {
        this._openPreferences();
      });
      this.menu.addMenuItem(settingsMenuItem);

      // Add refresh menu item
      let refreshMenuItem = new PopupMenu.PopupMenuItem("Refresh");
      refreshMenuItem.connect("activate", () => {
        this.refreshCards();
      });
      this.menu.addMenuItem(refreshMenuItem);

      // make sure its always up to date when clicked
      this.connect("button-press-event", () => {
        this.refreshCards();
      });

      // Initial load
      this.refreshCards();
    }

    _openPreferences() {
      // Open extension preferences
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

    createCard(list) {
      console.log("Creating new card");
      Gio.Subprocess.new(
        // TODO: retrieve board name
        [
          "kitty",
          "-e",
          "zsh",
          "-l",
          "-c",
          `EDITOR=nvim tro create work "${list.name}" -s`,
        ],
        Gio.SubprocessFlags.NONE,
      );
    }

    getBoardId() {
      const boardUrlRegex = /https:\/\/trello\.com\/b\/([a-zA-Z0-9]+)(?:\/|\b)/;
      const boardId = this._settings.get_string("board-id");
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
      const boardId = this.getBoardId();

      if (!apiKey || !token || !boardId) {
        throw new Error(
          "Missing Trello credentials. Please check extension settings.",
        );
      }

      fetchBoardLists(boardId, apiKey, token)
        .then((lists) => {
          // Remove loading indicator
          this.cardsSection.removeAll();

          if (!lists || lists.length === 0) {
            let noListsItem = new PopupMenu.PopupMenuItem("No lists found");
            this.cardsSection.addMenuItem(noListsItem);
            return;
          }

          let cardCount = 0;

          for (const list of lists) {
            // TODO: Hacky! needs to be updated
            if (list.name != "Today") {
              continue;
            }

            const cards = list.cards;
            cardCount += cards.length;

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
                await closeCard(card.id, apiKey, token);
                this.refreshCards();
              });

              buttonBox.add_child(closeButton);
              cardItem.add_child(buttonBox);

              // Open card in browser when clicked
              cardItem.connect("activate", () => {
                Gio.Subprocess.new(
                  // TODO: retrieve board name
                  [
                    "kitty",
                    "-e",
                    "zsh",
                    "-l",
                    "-c",
                    `EDITOR=nvim tro show work "${list.name}" "${card.name}"`,
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

          // Update the button text with card count if enabled
          if (this._settings.get_boolean("show-card-count")) {
            this.buttonText.set_text(`🃏 ${cardCount}`);
          } else {
            this.buttonText.set_text("🃏");
          }
        })
        .catch((error) => {
          this.cardsSection.removeAll();
          let errorItem = new PopupMenu.PopupMenuItem(
            `Error: ${error.message}`,
          );
          this.cardsSection.addMenuItem(errorItem);
        });
    }
  },
);

export default class TrelloCardsExtension extends Extension {
  constructor(metadata) {
    super(metadata);

    this._indicator = null;
    this._settingsChangedId = null;
  }

  enable() {
    console.log(`Enabling ${this.metadata.name}`);

    this._settings = this.getSettings(SCHEMA_NAME);

    // Create indicator
    this._indicator = new TrelloCardsIndicator(this._settings);
    Main.panel.addToStatusArea("trello-cards", this._indicator);

    // Set up the refresh timer
    this._setupTimer();

    // Connect to settings changes
    this._settingsChangedId = this._settings.connect("changed", () => {
      // Refresh cards with new settings
      if (this._indicator) {
        this._indicator.refreshCards();
      }

      // Reset the timer with new interval
      this._setupTimer();
    });
  }

  disable() {
    console.log(`Disabling ${this.metadata.name}`);
    if (this._indicator != null) {
      this._indicator.destroy();
      this._indicator = null;
    }

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
        if (this._indicator) {
          this._indicator.refreshCards();
        }
        return GLib.SOURCE_CONTINUE; // Continue the timer
      },
    );
  }
}
