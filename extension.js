import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

// Settings schema
const SCHEMA_NAME = 'org.gnome.shell.extensions.trello-cards';

let timeout;

const TrelloCardsIndicator = GObject.registerClass(
class TrelloCardsIndicator extends PanelMenu.Button {
    constructor(settings) {
        super(0.0, "Trello Cards");

        this._settings = settings;

        // Create the panel button with an icon
        this.buttonText = new St.Label({
            text: '🃏',
            y_align: Clutter.ActorAlign.CENTER
        });

        this.add_child(this.buttonText);

        // Create menu section for cards
        this.cardsSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this.cardsSection);

        // Add settings menu item
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let settingsMenuItem = new PopupMenu.PopupMenuItem("Settings");
        settingsMenuItem.connect('activate', () => {
            this._openPreferences();
        });
        this.menu.addMenuItem(settingsMenuItem);

        // Add refresh menu item
        let refreshMenuItem = new PopupMenu.PopupMenuItem("Refresh");
        refreshMenuItem.connect('activate', () => {
            this.refreshCards();
        });
        this.menu.addMenuItem(refreshMenuItem);

        // Initial load
        this.refreshCards();
    }

    _openPreferences() {
        // Open extension preferences
        try {
            const proc = Gio.Subprocess.new(
                ['gnome-extensions', 'prefs', 'trello-cards@yourdomain.com'],
                Gio.SubprocessFlags.NONE
            );
        } catch (e) {
            console.error(e);
        }
    }

    refreshCards() {
        this.cardsSection.removeAll();

        // Add a loading indicator
        let loadingItem = new PopupMenu.PopupMenuItem("Loading cards...");
        this.cardsSection.addMenuItem(loadingItem);

        this.fetchLists().then(lists => {
            for(const list of lists) {
                // TODO: Hacky! needs to be updated
                if (list.name != "Today") {
                    continue
                }

                const cards = list.cards;
                // Remove loading indicator
                this.cardsSection.removeAll();

                if (!cards || cards.length === 0) {
                    let noCardsItem = new PopupMenu.PopupMenuItem("No cards found");
                    this.cardsSection.addMenuItem(noCardsItem);
                    return;
                }

                // Update the button text with card count if enabled
                if (this._settings.get_boolean('show-card-count')) {
                    this.buttonText.set_text(`🃏 ${cards.length}`);
                } else {
                    this.buttonText.set_text('🃏');
                }

                // Add cards to the menu
                cards.forEach(card => {
                    let cardItem = new PopupMenu.PopupMenuItem(
                        `${card.name}`
                    );

                    // Add label indicators if card has labels
                    if (card.labels && card.labels.length > 0) {
                        let labelBox = new St.BoxLayout({
                            style_class: 'card-labels',
                            x_expand: true,
                            x_align: Clutter.ActorAlign.END
                        });

                        card.labels.forEach(label => {
                            let labelIndicator = new St.Icon({
                                style_class: 'card-label',
                                style: `background-color: ${label.color || '#999'};`,
                                icon_size: 8
                            });
                            labelBox.add_child(labelIndicator);
                        });

                        cardItem.add_child(labelBox);
                    }

                    // Open card in browser when clicked
                    cardItem.connect('activate', () => {
                        try {
                            const proc = Gio.Subprocess.new(
                                ['xdg-open', card.url],
                                Gio.SubprocessFlags.NONE
                            );
                        } catch (e) {
                            console.error(e);
                        }
                    });

                    this.cardsSection.addMenuItem(cardItem);
                });

                // Add a "View Board" item
                this.cardsSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                let viewBoardItem = new PopupMenu.PopupMenuItem("View Board in Browser");
                viewBoardItem.connect('activate', () => {
                    try {
                        const boardId = this._settings.get_string('board-id');
                        const proc = Gio.Subprocess.new(
                            ['xdg-open', `https://trello.com/b/${boardId}`],
                            Gio.SubprocessFlags.NONE
                        );
                    } catch (e) {
                        console.error(e);
                    }
                });
                this.cardsSection.addMenuItem(viewBoardItem);
            }
        }).catch(error => {
            this.cardsSection.removeAll();
            let errorItem = new PopupMenu.PopupMenuItem(`Error: ${error.message}`);
            this.cardsSection.addMenuItem(errorItem);
        });
    }

    async fetchLists() {
        try {
            const apiKey = this._settings.get_string('api-key');
            const token = this._settings.get_string('token');
            const boardId = this._settings.get_string('board-id');

            if (!apiKey || !token || !boardId) {
                throw new Error("Missing Trello credentials. Please check extension settings.");
            }

            // Create the session
            let session = new Soup.Session();
            let message = Soup.Message.new(
                'GET',
                `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}&cards=open`
            );

            // Using Soup 3.0 API (GNOME 40+)
            const bytes = await new Promise((resolve, reject) => {
                session.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    null,
                    (session, result) => {
                        try {
                            const status = message.get_status();
                            if (status !== Soup.Status.OK) {
                                reject(new Error(`HTTP error ${status}`));
                                return;
                            }

                            const bytes = session.send_and_read_finish(result);
                            resolve(bytes);
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            // Parse the response
            const decoder = new TextDecoder('utf-8');
            const response = decoder.decode(bytes.get_data());
            const cards = JSON.parse(response);
            return cards;

        } catch (error) {
            console.error(error);
            throw error;
        }
    }
});

export default class TrelloCardsExtension extends Extension {
    constructor(metadata) {
        super(metadata);

        this._indicator = null;
        this._settingsChangedId = null;
    }

    enable() {
        console.log(`Enabling ${this.metadata.name}`);

        // Get settings
        this._settings = this.getSettings(SCHEMA_NAME);

        // Create indicator
        this._indicator = new TrelloCardsIndicator(this._settings);
        Main.panel.addToStatusArea('trello-cards', this._indicator);

        // Set up the refresh timer
        this._setupTimer();

        // Connect to settings changes
        this._settingsChangedId = this._settings.connect('changed', () => {
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
        const refreshInterval = this._settings.get_int('refresh-interval') * 60;

        // Create a new timer to refresh cards periodically
        timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, refreshInterval, () => {
            if (this._indicator) {
                this._indicator.refreshCards();
            }
            return GLib.SOURCE_CONTINUE; // Continue the timer
        });
    }
}
