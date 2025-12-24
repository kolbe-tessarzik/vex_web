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
                this.selectSelected.innerHTML = `Select an option<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

                // create selection options
                this.selectItems    = document.createElement('div');
                this.selectItems.classList.add('select-items', 'select-hide');

                // inject them into the outer div
                this.container.append(this.selectSelected, this.selectItems);
                this.container.classList.add('custom-select');
                console.log(`Done! ${this.selectItems}`);
            }

            _initDropdown() {
                // Close the dropdown if the user clicks outside of it
                document.addEventListener('click', (e) => {
                    console.log(this.selectItems);
                    if (!e.target.closest('.custom-select')) {
                        this.selectItems.classList.add('select-hide');
                        this.selectItems.classList.remove('shadowed');
                        // make sure the selection box is visible again when the list is closed
                        this.selectSelected.classList.remove('overlay-hidden');
                    }
                });

                this.selectSelected.addEventListener('click', () => {
                    const isHidden = this.selectItems.classList.toggle('select-hide');
                    this.selectItems.classList.toggle('shadowed');
                    // when opening, visually hide the selection box so its content isn't
                    // duplicated (the list still contains the selected item). When closing,
                    // restore the selection box visibility.
                    if (!isHidden) {
                        this.selectSelected.classList.add('overlay-hidden');
                    } else {
                        this.selectSelected.classList.remove('overlay-hidden');
                    }
                });
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
                this._options = Array.isArray(options) ? options.slice() : [];
                this.selectItems.innerHTML = '';
                options.forEach(optionData => {
                    const item = document.createElement('div');
                    item.classList.add("list-el");
                    item.dataset.value = optionData.value || optionData.text;
                    item.title = optionData.path;
                    const largeText = document.createElement('span');
                    largeText.classList.add('large-text');
                    largeText.textContent = optionData.text + "\n";

                    const smallText = document.createElement('span');
                    smallText.classList.add('small-text');
                    smallText.textContent = optionData.path;

                    // Use an arrow function so `this` refers to the Dropdown instance
                    item.addEventListener('click', () => {
                        this.selectSelected.innerHTML = item.innerHTML;
                        this.selectSelected.innerHTML += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 8" width="12" height="8" class="my-svg" aria-hidden="true"><path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                        this.selectItems.classList.add('select-hide');
                        this.selectItems.classList.remove('shadowed');
                        // set selected value
                        this.selectedValue = optionData.value || optionData.text;
                        // dispatch an event so external code can react to selection
                        this.container.dispatchEvent(new CustomEvent('dropdown-select', { detail: { value: this.selectedValue, text: optionData.text, path: optionData.path } }));
                    });
                    item.appendChild(largeText);
                    item.appendChild(smallText);
                    this.selectItems.appendChild(item);
                    console.log(this.selectItems.innerHTML);
                });
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

        const optionsData = [
            { path: 'Code/Vex/Project1', text: 'Project1', value: "Hello" },
            { path: 'Code/Vex/Projects/Project2.iqpython', text: 'Project2', value: new Array(5) },
            { path: 'Code/Other/Project3', text: 'Project3', value: "My name is bob" }
        ];
