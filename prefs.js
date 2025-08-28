import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Import validation functions - dynamically import to avoid issues in preferences context
let validateBoardAccess = null;
let fetchAvailableLists = null;
let matchesGlobPattern = null;

// Lazy load the validation functions
async function loadValidationFunctions() {
  if (!validateBoardAccess) {
    try {
      const module = await import("./trello.js");
      validateBoardAccess = module.validateBoardAccess;
      fetchAvailableLists = module.fetchAvailableLists;
      matchesGlobPattern = module.matchesGlobPattern;
    } catch (error) {
      console.error("Failed to load validation functions:", error);
    }
  }
}

export default class TrelloCardsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    // Get the settings
    const settings = this.getSettings(
      "org.gnome.shell.extensions.trello-cards",
    );

    // Create a preferences page
    const page = new TrelloCardsPreferencesPage(settings);

    // Add the page to the window
    window.add(page);
  }
}

const TrelloCardsPreferencesPage = GObject.registerClass(
  class TrelloCardsPreferencesPage extends Adw.PreferencesPage {
    _init(settings) {
      super._init({
        title: _("Trello Cards Settings"),
        icon_name: "preferences-system-symbolic",
        name: "TrelloCardsPreferencesPage",
      });

      this._settings = settings;

      // API Settings Group
      const apiGroup = new Adw.PreferencesGroup({
        title: _("Trello API Settings"),
        description: _("Enter your Trello API credentials"),
      });

      // API Key
      let apiKeyRow = new Adw.EntryRow({
        title: _("API Key"),
        text: this._settings.get_string("api-key") || "",
      });
      apiKeyRow.connect("changed", (entry) => {
        this._settings.set_string("api-key", entry.get_text());
      });
      apiGroup.add(apiKeyRow);

      // Token
      let tokenRow = new Adw.EntryRow({
        title: _("Token"),
        text: this._settings.get_string("token") || "",
      });
      tokenRow.connect("changed", (entry) => {
        this._settings.set_string("token", entry.get_text());
      });
      apiGroup.add(tokenRow);

      // Add help text for obtaining API credentials
      let helpGroup = new Adw.PreferencesGroup({
        title: _("How to get your API credentials"),
      });

      let helpBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
        spacing: 10,
      });

      let helpLabel = new Gtk.Label({
        label:
          "1. Get your API Key from https://trello.com/app-key\n" +
          "2. Get your Token by visiting the URL provided on the API Key page\n" +
          "3. Board IDs are specified per list in the Target Lists section below\n" +
          "   (e.g., https://trello.com/b/BOARD_ID/board-name or just BOARD_ID)\n\n" +
          "Glob Pattern Examples:\n" +
          "• 'Today' - exact match only\n" +
          "• '*Today*' - matches any text containing 'Today' (📅 Today ✨, Today's Tasks)\n" +
          "• '📅*' - matches any list starting with 📅 emoji\n" +
          "• '*Progress*' - matches lists containing 'Progress' (🔄 In Progress, Progress Report)",
        halign: Gtk.Align.START,
        wrap: true,
        xalign: 0,
      });

      helpBox.append(helpLabel);
      helpGroup.add(helpBox);

      // Display options group
      const displayGroup = new Adw.PreferencesGroup({
        title: _("Display Settings"),
      });

      // Refresh interval
      let refreshAdjustment = new Gtk.Adjustment({
        lower: 1,
        upper: 60,
        step_increment: 1,
        value: this._settings.get_int("refresh-interval") || 5,
      });

      let refreshRow = new Adw.SpinRow({
        title: _("Refresh Interval (minutes)"),
        adjustment: refreshAdjustment,
      });
      refreshRow.connect("notify::value", (row) => {
        this._settings.set_int("refresh-interval", row.get_value());
      });
      displayGroup.add(refreshRow);

      // Show card count
      let showCountRow = new Adw.SwitchRow({
        title: _("Show Card Count"),
        active: this._settings.get_boolean("show-card-count"),
      });
      showCountRow.connect("notify::active", (row) => {
        this._settings.set_boolean("show-card-count", row.get_active());
      });
      displayGroup.add(showCountRow);

      // Show list names
      let showNamesRow = new Adw.SwitchRow({
        title: _("Show List Names"),
        subtitle: _("Display list names in panel buttons"),
        active: this._settings.get_boolean("show-list-names"),
      });
      showNamesRow.connect("notify::active", (row) => {
        this._settings.set_boolean("show-list-names", row.get_active());
      });
      displayGroup.add(showNamesRow);

      // Show emojis
      let showEmojisRow = new Adw.SwitchRow({
        title: _("Show Emojis"),
        subtitle: _("Display emojis in panel buttons"),
        active: this._settings.get_boolean("show-emojis"),
      });
      showEmojisRow.connect("notify::active", (row) => {
        this._settings.set_boolean("show-emojis", row.get_active());
      });
      displayGroup.add(showEmojisRow);

      // Target Lists group
      const listsGroup = new Adw.PreferencesGroup({
        title: _("Target Lists"),
        description: _(
          "Configure which Trello lists to show as separate buttons. Supports glob patterns: * (any text), ? (any character)",
        ),
      });

      // Create container for target lists management
      this._createTargetListsUI(listsGroup);

      // Add all groups to the page
      this.add(apiGroup);
      this.add(helpGroup);
      this.add(displayGroup);
      this.add(listsGroup);
    }

    _createTargetListsUI(listsGroup) {
      // Create a box to hold the list items and controls
      this._listsBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
      });

      // Create scrolled window for the lists
      const scrolled = new Gtk.ScrolledWindow({
        min_content_height: 200,
        max_content_height: 400,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
        vscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
      });

      // Create list box to hold target lists
      this._targetListsBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ["boxed-list"],
      });

      scrolled.set_child(this._targetListsBox);
      this._listsBox.append(scrolled);

      // Add existing lists to the UI
      this._refreshTargetListsUI();

      // Create add section
      const addSection = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 12,
      });

      // Add form for new list
      const addGrid = new Gtk.Grid({
        column_spacing: 6,
        row_spacing: 6,
      });

      // List name entry
      const nameLabel = new Gtk.Label({
        label: _("List Name/Pattern:"),
        halign: Gtk.Align.START,
      });
      this._newListNameEntry = new Gtk.Entry({
        placeholder_text: _("List name or pattern (e.g., *Today*, 📅*)"),
        hexpand: true,
      });

      // Board ID entry
      const boardLabel = new Gtk.Label({
        label: _("Board ID*:"),
        halign: Gtk.Align.START,
      });
      this._newBoardIdEntry = new Gtk.Entry({
        placeholder_text: _("Required: Board ID or URL"),
        hexpand: true,
      });

      // Emoji button (displays selected emoji and opens picker)
      const emojiLabel = new Gtk.Label({
        label: _("Emoji:"),
        halign: Gtk.Align.START,
      });

      this._newEmojiButton = new Gtk.Button({
        label: "📋",
        tooltip_text: _("Click to choose emoji"),
        css_classes: ["emoji-button"],
      });

      addGrid.attach(nameLabel, 0, 0, 1, 1);
      addGrid.attach(this._newListNameEntry, 1, 0, 2, 1);
      addGrid.attach(boardLabel, 0, 1, 1, 1);
      addGrid.attach(this._newBoardIdEntry, 1, 1, 2, 1);
      addGrid.attach(emojiLabel, 0, 2, 1, 1);
      addGrid.attach(this._newEmojiButton, 1, 2, 1, 1);

      const addButton = new Gtk.Button({
        label: _("Add List"),
        css_classes: ["suggested-action"],
        margin_start: 6,
      });
      addGrid.attach(addButton, 2, 2, 1, 1);

      // Add validation button
      const validateButton = new Gtk.Button({
        label: _("Validate"),
        css_classes: ["secondary"],
        margin_start: 6,
      });
      addGrid.attach(validateButton, 3, 2, 1, 1);

      // Connect add functionality
      addButton.connect("clicked", () => {
        this._addTargetList();
      });

      // Connect validation functionality
      validateButton.connect("clicked", () => {
        this._validateNewList();
      });

      // Connect emoji picker functionality
      this._newEmojiButton.connect("clicked", () => {
        this._showEmojiChooser(this._newEmojiButton);
      });

      this._newListNameEntry.connect("activate", () => {
        this._addTargetList();
      });

      addSection.append(addGrid);
      this._listsBox.append(addSection);

      listsGroup.add(this._listsBox);
    }

    _refreshTargetListsUI() {
      // Clear existing list items
      let child = this._targetListsBox.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        this._targetListsBox.remove(child);
        child = next;
      }

      // Get current target lists configuration
      const listsConfig = this._getTargetListsConfig();

      // Add each list to the UI
      listsConfig.forEach((listConfig, index) => {
        const row = new Adw.ExpanderRow({
          title: `${listConfig.emoji} ${listConfig.listName}`,
          subtitle: listConfig.boardId || _("⚠️ Missing board ID"),
        });

        // Create edit section
        const editGrid = new Gtk.Grid({
          column_spacing: 6,
          row_spacing: 6,
          margin_top: 6,
          margin_bottom: 6,
          margin_start: 6,
          margin_end: 6,
        });

        // Edit controls
        const nameEntry = new Gtk.Entry({
          text: listConfig.listName,
          hexpand: true,
        });
        const boardEntry = new Gtk.Entry({
          text: listConfig.boardId || "",
          hexpand: true,
        });
        const emojiButton = new Gtk.Button({
          label: listConfig.emoji || "📋",
          tooltip_text: _("Click to choose emoji"),
          css_classes: ["emoji-button"],
        });

        editGrid.attach(
          new Gtk.Label({ label: _("Name/Pattern:"), halign: Gtk.Align.START }),
          0,
          0,
          1,
          1,
        );
        editGrid.attach(nameEntry, 1, 0, 2, 1);
        editGrid.attach(
          new Gtk.Label({ label: _("Board ID*:"), halign: Gtk.Align.START }),
          0,
          1,
          1,
          1,
        );
        editGrid.attach(boardEntry, 1, 1, 2, 1);
        editGrid.attach(
          new Gtk.Label({ label: _("Emoji:"), halign: Gtk.Align.START }),
          0,
          2,
          1,
          1,
        );
        editGrid.attach(emojiButton, 1, 2, 1, 1);

        const updateButton = new Gtk.Button({
          label: _("Update"),
          css_classes: ["suggested-action"],
        });
        editGrid.attach(updateButton, 2, 2, 1, 1);

        // Connect edit emoji picker functionality
        emojiButton.connect("clicked", () => {
          this._showEmojiChooser(emojiButton);
        });

        updateButton.connect("clicked", () => {
          const name = nameEntry.get_text().trim();
          const boardId = boardEntry.get_text().trim();
          const emoji = emojiButton.get_label() || "📋";

          if (!name || !boardId) {
            return;
          }

          this._updateTargetList(index, {
            listName: name,
            boardId: boardId,
            emoji: emoji,
          });
        });

        row.add_row(editGrid);

        const deleteButton = new Gtk.Button({
          icon_name: "user-trash-symbolic",
          css_classes: ["destructive-action"],
          valign: Gtk.Align.CENTER,
        });

        deleteButton.connect("clicked", () => {
          this._removeTargetList(index);
        });

        row.add_suffix(deleteButton);
        this._targetListsBox.append(row);
      });
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

    _setTargetListsConfig(config) {
      const configStr = JSON.stringify(config);
      this._settings.set_string("target-lists-config", configStr);
    }

    async _validateNewList() {
      const newListName = this._newListNameEntry.get_text().trim();
      const newBoardId = this._newBoardIdEntry.get_text().trim();

      if (!newListName || !newBoardId) {
        this._showValidationMessage(
          "Please enter both list name and board ID",
          "error",
        );
        return;
      }

      this._showValidationMessage("Validating...", "info");

      try {
        await loadValidationFunctions();

        if (
          !validateBoardAccess ||
          !fetchAvailableLists ||
          !matchesGlobPattern
        ) {
          this._showValidationMessage(
            "Validation functions not available",
            "error",
          );
          return;
        }

        const apiKey = this._settings.get_string("api-key");
        const token = this._settings.get_string("token");

        if (!apiKey || !token) {
          this._showValidationMessage(
            "Please set API key and token first",
            "error",
          );
          return;
        }

        // Extract board ID from URL if needed
        const boardUrlRegex =
          /https:\/\/trello\.com\/b\/([a-zA-Z0-9]+)(?:\/|\b)/;
        const extractedBoardId =
          newBoardId.match(boardUrlRegex)?.[1] || newBoardId;

        // Validate board access
        console.log("Validating board access...");
        const boardInfo = await validateBoardAccess(
          extractedBoardId,
          apiKey,
          token,
        );

        // Fetch available lists
        console.log("Fetching available lists...");
        const availableLists = await fetchAvailableLists(
          extractedBoardId,
          apiKey,
          token,
        );

        // Check for pattern matches
        const matchingLists = availableLists.filter((list) =>
          matchesGlobPattern(list.name, newListName),
        );

        if (matchingLists.length > 0) {
          const matchedNames = matchingLists
            .map((l) => `"${l.name}"`)
            .join(", ");
          this._showValidationMessage(
            `✅ Pattern "${newListName}" matches ${matchingLists.length} list(s) on board "${boardInfo.name}"\nMatched: ${matchedNames}`,
            "success",
          );
        } else {
          const availableListNames = availableLists
            .map((l) => `"${l.name}"`)
            .join(", ");
          this._showValidationMessage(
            `❌ Pattern "${newListName}" matches no lists on board "${boardInfo.name}"\nAvailable lists: ${availableListNames}\nTry patterns like: *Today*, 📅*, *Progress*`,
            "error",
          );
        }
      } catch (error) {
        console.error("Validation failed:", error);
        this._showValidationMessage(
          `❌ Validation failed: ${error.message}`,
          "error",
        );
      }
    }

    _showValidationMessage(message, type) {
      // Remove existing validation message if any
      if (this._validationLabel) {
        this._validationLabel.get_parent()?.remove(this._validationLabel);
      }

      // Create new validation message
      this._validationLabel = new Gtk.Label({
        label: message,
        wrap: true,
        margin_top: 6,
        margin_bottom: 6,
      });

      // Style based on type
      const cssClasses = {
        success: ["success"],
        error: ["error"],
        info: ["dim-label"],
      };

      if (cssClasses[type]) {
        this._validationLabel.add_css_class(cssClasses[type][0]);
      }

      // Add to the UI (after the add form)
      this._listsBox.append(this._validationLabel);
    }

    _addTargetList() {
      const newListName = this._newListNameEntry.get_text().trim();
      const newBoardId = this._newBoardIdEntry.get_text().trim();
      const newEmoji = this._newEmojiButton.get_label() || "📋";

      if (!newListName || !newBoardId) {
        this._showValidationMessage(
          "Please enter both list name and board ID",
          "error",
        );
        return;
      }

      const currentLists = this._getTargetListsConfig();

      // Check if list already exists with same name and board
      const exists = currentLists.some(
        (list) => list.listName === newListName && list.boardId === newBoardId,
      );

      if (exists) {
        this._showValidationMessage(
          "This list configuration already exists",
          "error",
        );
        return;
      }

      // Add the new list
      currentLists.push({
        listName: newListName,
        boardId: newBoardId,
        emoji: newEmoji,
      });

      this._setTargetListsConfig(currentLists);

      // Clear the entries and refresh the UI
      this._newListNameEntry.set_text("");
      this._newBoardIdEntry.set_text("");
      this._newEmojiButton.set_label("📋");
      this._refreshTargetListsUI();

      // Clear validation message
      if (this._validationLabel) {
        this._validationLabel.get_parent()?.remove(this._validationLabel);
        this._validationLabel = null;
      }

      console.log(
        `Added new list configuration: "${newListName}" on board ${newBoardId}`,
      );
    }

    _showEmojiChooser(emojiButton) {
      // Create the emoji chooser
      const emojiChooser = new Gtk.EmojiChooser();

      // Position it relative to the button
      emojiChooser.set_parent(emojiButton);

      // Connect to the emoji-picked signal
      emojiChooser.connect("emoji-picked", (chooser, emoji) => {
        // Set the selected emoji as the button label
        emojiButton.set_label(emoji);
        console.log(`Selected emoji: ${emoji}`);

        // Close the popover
        emojiChooser.popdown();
      });

      // Show the emoji chooser
      emojiChooser.popup();
    }

    _updateTargetList(index, newConfig) {
      const currentLists = this._getTargetListsConfig();

      if (
        index >= 0 &&
        index < currentLists.length &&
        newConfig.listName &&
        newConfig.boardId
      ) {
        currentLists[index] = newConfig;
        this._setTargetListsConfig(currentLists);
        this._refreshTargetListsUI();
      }
    }

    _removeTargetList(index) {
      const currentLists = this._getTargetListsConfig();

      // Remove the list at the specified index
      if (index >= 0 && index < currentLists.length) {
        currentLists.splice(index, 1);
        this._setTargetListsConfig(currentLists);
        this._refreshTargetListsUI();
      }
    }
  },
);
