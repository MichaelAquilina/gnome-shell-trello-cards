import GObject from "gi://GObject";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

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

      // Board ID
      let boardRow = new Adw.EntryRow({
        title: _("Board ID"),
        text: this._settings.get_string("board-id") || "",
      });
      boardRow.connect("changed", (entry) => {
        this._settings.set_string("board-id", entry.get_text());
      });
      apiGroup.add(boardRow);

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
          "3. Get the Board ID from the URL of your Trello board\n" +
          "   (e.g., https://trello.com/b/BOARD_ID/board-name)",
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

      // Add all groups to the page
      this.add(apiGroup);
      this.add(helpGroup);
      this.add(displayGroup);
    }
  },
);
