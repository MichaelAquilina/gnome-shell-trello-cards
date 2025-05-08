compile-schemas:
	glib-compile-schemas schemas

install: compile-schemas
	rm -rf ~/.local/share/gnome-shell/extensions/trello-cards@michaelaquilina.github.io
	cp -r $$PWD ~/.local/share/gnome-shell/extensions/trello-cards@michaelaquilina.github.io

package: compile-schemas
	rm *.zip
	zip -r trello-cards@michaelaquilina.github.io.zip . --exclude=README.md --exclude=.gitignore --exclude=screenshot.png --exclude=.git/\* --exclude=.circleci/\* --exclude=Makefile
