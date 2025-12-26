let dropdownRequiredStyle = `
        .custom-select {
            position: relative;
        }

        .select-selected {
            padding: 10px;
            border: 1px solid #ccc;
            cursor: pointer;
            display: flex;
            align-items: flex-end;
            gap: 8px;
        }

        .select-items {
            position: absolute;
            background-color: #fff;
            /* overlay the selection so the list appears on top of the selected box */
            top: 0;
            left: 0;
            right: 0;
            z-index: 1000;
            border: 1px solid #ccc;
            border-top: none;
            gap: 8px;
        }

        .select-items div {
            padding: 10px;
            cursor: pointer;
        }

        .select-hide {
            display: none;
        }

        .list-el:hover {
            background-color: #aaa;
        }

        .list-el:focus, .list-el.focused {
            background-color: #ddd;
            outline: none;
        }

        /* hide the item that matches the current selection while the list is open so the
           selected value isn't visible twice (once in the selection box and once in the list) */
          /* when the list is open we hide the selection box content so the selected value
              isn't visible twice; the list itself still contains all options */
          .select-selected.overlay-hidden { visibility: hidden; }

        .shadowed {
            box-shadow: 5px 5px 15px 2px rgba(0, 0, 0, 0.3);
        }

        .large-text {
            font-size: 20px;
        }

        .small-text {
            color: #ccc;
            font-size: 16px;
        }

        .my-svg {
            margin-left: auto;
            width: 24px;
            height: 16px;
        }`;

let dropdownStyleInjected = false;

class Dropdown {
    constructor(options, outerDiv = null) {
        if (outerDiv === null) {
            this.container = document.createElement('div');
            document.body.appendChild(this.container);
        } else {
            this.container = outerDiv;
        }
        this._empty = true;
        this._createElements();
        this._initDropdown();
        this.update_options(options);
        this._styleDropdown();
    }

    _createElements() {
        console.log("Creating . . .");
        // wipe away anything already inside the div
        this.container.innerHTML = "";

        // create selection box
        this.selectSelected = document.createElement('div');
        this.selectSelected.classList.add('select-selected');
        // make it focusable and accessible
        this.selectSelected.tabIndex = 0;
        this.selectSelected.setAttribute('role', 'combobox');
        this.selectSelected.setAttribute('aria-haspopup', 'listbox');
        this.selectSelected.setAttribute('aria-expanded', 'false');
        this.selectSelected.innerHTML = `Select an option<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

        // create selection options
        this.selectItems = document.createElement('div');
        this.selectItems.classList.add('select-items', 'select-hide');
        this.selectItems.setAttribute('role', 'listbox');
        // unique id for aria-controls
        Dropdown._idCounter = (Dropdown._idCounter || 0) + 1;
        this.selectItems.id = `dropdown-list-${Dropdown._idCounter}`;
        this.selectSelected.setAttribute('aria-controls', this.selectItems.id);

        // inject them into the outer div
        this.container.append(this.selectSelected, this.selectItems);
        this.container.classList.add('custom-select');
        console.log(`Done! ${this.selectItems}`);
    }

    _initDropdown() {
        this._emptyCallback = () => { };
        // Close the dropdown if the user clicks outside of it
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.custom-select')) {
                this.selectItems.classList.add('select-hide');
                this.selectItems.classList.remove('shadowed');
                // make sure the selection box is visible again when the list is closed
                this.selectSelected.classList.remove('overlay-hidden');
                this.selectSelected.setAttribute('aria-expanded', 'false');
                // remove any focused state from items
                this._clearFocusedItem();
            }
        });

        // click opens/closes
        this.selectSelected.addEventListener('click', async (e) => {
            e.preventDefault();
            if (this._empty) {
                try {
                    await this._emptyCallback();
                } catch (error) {
                    try {
                        this._emptyCallback();
                    } catch (err) {
                        console.warn("Error in empty callback:", err);
                        return;
                    }
                }
            }
            this.toggle();

        });

        // keyboard interactions on the selection box
        this.selectSelected.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'Enter':
                case ' ': // Space
                    e.preventDefault();
                    this.toggle(true);
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.open();
                    this._focusFirstItem();
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    this.open();
                    this._focusLastItem();
                    break;
                case 'Escape':
                    this.close();
                    break;
            }
        });
    }

    setEmptyCallback(callback) {
        this._emptyCallback = callback;
    }

    // Open dropdown and update aria + visuals
    open() {
        console.log("Opening dropdown . . .");
        if (this._empty) {
            console.log("Dropdown is empty, not opening.");
            this._emptyCallback();
            return;
        }
        this.selectItems.classList.remove('select-hide');
        this.selectItems.classList.add('shadowed');
        this.selectSelected.classList.add('overlay-hidden');
        this.selectSelected.setAttribute('aria-expanded', 'true');
    }

    // Close dropdown and update aria + visuals
    close() {
        this.selectItems.classList.add('select-hide');
        this.selectItems.classList.remove('shadowed');
        this.selectSelected.classList.remove('overlay-hidden');
        this.selectSelected.setAttribute('aria-expanded', 'false');
        this._clearFocusedItem();
        this.selectSelected.focus();
    }

    // Toggle dropdown open/closed. If viaKeyboard true, focus moves appropriately
    toggle(viaKeyboard = false) {
        const isHidden = this.selectItems.classList.toggle('select-hide');
        this.selectItems.classList.toggle('shadowed');
        if (!isHidden) {
            this.selectSelected.classList.add('overlay-hidden');
            this.selectSelected.setAttribute('aria-expanded', 'true');
            if (viaKeyboard) this._focusFirstItem();
        } else {
            this.selectSelected.classList.remove('overlay-hidden');
            this.selectSelected.setAttribute('aria-expanded', 'false');
            this._clearFocusedItem();
        }
    }

    _focusFirstItem() {
        const first = this.selectItems.querySelector('.list-el');
        if (first) this._focusItemElement(first);
    }

    _focusLastItem() {
        const items = this.selectItems.querySelectorAll('.list-el');
        const last = items[items.length - 1];
        if (last) this._focusItemElement(last);
    }

    _focusItemElement(el) {
        this._clearFocusedItem();
        el.tabIndex = 0;
        el.classList.add('focused');
        el.focus();
        // keep track of focused index
        const items = Array.from(this.selectItems.querySelectorAll('.list-el'));
        this._focusedIndex = items.indexOf(el);
    }

    _clearFocusedItem() {
        const focused = this.selectItems.querySelector('.list-el.focused');
        if (focused) {
            focused.classList.remove('focused');
            focused.tabIndex = -1;
        }
        this._focusedIndex = -1;
    }

    _styleDropdown() {
        if (dropdownStyleInjected) return;
        const styling = document.createElement('style');
        styling.innerHTML = dropdownRequiredStyle;
        // actually inject the CSS into the document
        document.head.appendChild(styling);
        dropdownStyleInjected = true;
    }

    update_options(options) {
        // store options for later use
        if (!options || !Array.isArray(options) || options.length === 0) {
            // Treat empty arrays as "no options" so the Dropdown can
            // invoke its empty callback (e.g., to prompt user to import projects).
            this._empty = true;
            options = [{ path: '', text: 'No options available', value: null }];
        } else {
            this._empty = false;
            options = options.slice();
        }
        // keep a copy for other methods (e.g., setValue)
        this._options = options;
        this.selectItems.innerHTML = '';
        options.forEach(optionData => {
            const item = document.createElement('div');
            item.classList.add("list-el");
            item.dataset.value = optionData.value || optionData.text;
            item.title = optionData.path;
            // accessibility attributes
            item.tabIndex = -1;
            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', 'false');
            const largeText = document.createElement('span');
            largeText.classList.add('large-text');
            largeText.textContent = optionData.text + "\n";

            const smallText = document.createElement('span');
            smallText.classList.add('small-text');
            smallText.textContent = optionData.path;

            // Use an arrow function so `this` refers to the Dropdown instance
            const doSelect = () => {
                // update displayed selection
                this.selectSelected.innerHTML = item.innerHTML;
                this.selectSelected.innerHTML += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                // visually close
                this.selectItems.classList.add('select-hide');
                this.selectItems.classList.remove('shadowed');
                this.selectSelected.classList.remove('overlay-hidden');
                this.selectSelected.setAttribute('aria-expanded', 'false');
                // clear focused state
                this._clearFocusedItem();
                // set selected value
                this.selectedValue = optionData.value || optionData.text;
                // mark aria-selected
                this.selectItems.querySelectorAll('.list-el').forEach(el => el.setAttribute('aria-selected', 'false'));
                item.setAttribute('aria-selected', 'true');
                // dispatch an event so external code can react to selection
                this.container.dispatchEvent(new CustomEvent('dropdown-select', { detail: { value: this.selectedValue, text: optionData.text, path: optionData.path } }));
                this.selectSelected.focus();
            };

            item.addEventListener('click', doSelect);

            // add keyboard support on each item
            item.addEventListener('keydown', (e) => {
                switch (e.key) {
                    case 'ArrowDown':
                        e.preventDefault();
                        this._moveFocus(1);
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        this._moveFocus(-1);
                        break;
                    case 'Home':
                        e.preventDefault();
                        this._focusFirstItem();
                        break;
                    case 'End':
                        e.preventDefault();
                        this._focusLastItem();
                        break;
                    case 'Enter':
                    case ' ': // Space
                        e.preventDefault();
                        doSelect();
                        break;
                    case 'Escape':
                        e.preventDefault();
                        this.close();
                        break;
                }
            });

            // mouseover should highlight for mouse users
            item.addEventListener('mouseenter', () => {
                this._focusItemElement(item);
            });
            item.appendChild(largeText);
            item.appendChild(smallText);
            this.selectItems.appendChild(item);
            // reflect current selection if present
            if ((optionData.value || optionData.text) === this.selectedValue) {
                item.setAttribute('aria-selected', 'true');
                this.selectSelected.innerHTML = item.innerHTML + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            }
        });
        // reset focused index
        this._focusedIndex = -1;
    }

    addOption(option) {
        this.update_options([...this._options, option]);
    }

    _moveFocus(delta) {
        const items = Array.from(this.selectItems.querySelectorAll('.list-el'));
        if (!items.length) return;
        let idx = this._focusedIndex;
        if (idx < 0) {
            idx = delta > 0 ? 0 : items.length - 1;
        } else {
            idx = (idx + delta + items.length) % items.length;
        }
        this._focusItemElement(items[idx]);
    }

    setValue(value) {
        if (!this._options) return;
        const opt = this._options.find(o => (o.value || o.text) === value);
        if (!opt) return;
        // set displayed selection
        this.selectSelected.innerHTML = `<span class="large-text">${opt.text}</span><span class="my-svg"></span>`;
        // append caret svg similar to click
        this.selectSelected.innerHTML = `<span class="large-text">${opt.text}</span><span class="small-text">${opt.path}</span><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        this.selectedValue = opt.value || opt.text;
    }

    clearSelection() {
        this.selectedValue = undefined;
        this.selectSelected.innerHTML = 'Select an option<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>';
    }

    onSelect(handler) {
        this.container.addEventListener('dropdown-select', (e) => handler(e.detail));
    }
}
