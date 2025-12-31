class Project {
    #typePromise = null; // private field to store the cached Promise

    /*
    * @constructor
    * @param {string} path
    * @param {FileSystemHandle} handle
    */
    constructor(path, handle) {
        /** @type {string} */
        this.path = path;
        /** @type {FileSystemHandle} */
        this.handle = handle;
        if (handle.name.endsWith('.iqpython'))
        {
            if (!(handle instanceof FileSystemFileHandle)) {
                throw new TypeError("Expected a FileSystemFileHandle");
            }
        } else {
            if (!(handle instanceof FileSystemDirectoryHandle)) {
                throw new TypeError("Expected a FileSystemDirectoryHandle");
            }
        }
    }

    async #fetchType() {
        if (this.handle.name.endsWith('.iqpython')) {
            return 'iqpython';
        } else if (this.handle instanceof FileSystemDirectoryHandle) {
            const jsonHandle = await (await this.handle.getDirectoryHandle('.vscode')).getFileHandle('vex_project_settings.json');
            const jsonFile = await jsonHandle.getFile();
            const jsonText = await jsonFile.text();
            const settings = JSON.parse(jsonText);
            if (settings.project.language === "python") {
                return 'vscode.python';
            } else {
                throw new TypeError(`Unsupported vscode project language: ${settings.project.language}`);
            }
        } else {
            throw new TypeError("Unknown Project type");
        }
    }

    /**
     * An async getter that caches its result. Access this using `await instance.type`.
     */
    get type() {
        if (this.#typePromise === null) {
            // Cache the promise immediately when the getter is first accessed
            this.#typePromise = this.#fetchType();
        }
        // Always return the promise (cached or new)
        return this.#typePromise;
    }

    /*
    * @param {Project} other
    */
    async equals(other) {
        return (
            (other instanceof Project)
            && (other.path === this.path)
            && (await other.handle.isSameEntry(this.handle))
        );
    }

    static fromStored(obj) {
        if (   obj
            && typeof obj === 'object'
            && typeof obj.path === 'string'
            && obj.handle
            && (   obj.handle instanceof FileSystemFileHandle
                || obj.handle instanceof FileSystemDirectoryHandle)
        ) {
            return new Project(obj.path, obj.handle);
        }
        else {
            return undefined;
        }
    }

    /*
    * @returns {FileSystemFileHandle} jsonHandle
    */
    async jsonHandle() {
        switch (await this.type) {
            case ('iqpython'):
                return this.handle;
            case ('vscode.python'):
                return await (await this.handle.getDirectoryHandle('.vscode')).getFileHandle('vex_project_settings.json');
            default:
                throw new Error(`Unexpected project type: ${await this.type}`);
        }
    }

    async json() {
        const jsonFile = await (await this.jsonHandle()).getFile();
        const jsonText = await jsonFile.text();
        const dict = JSON.parse(jsonText);
        if (dict) {
            return dict;
        } else {
            throw new Error(`JSON parsed to ${dict}`);
        }
    }

    async name() {
        switch (await this.type) {
            case ('iqpython'):
                return this.handle.name.slice(0, -9);
            case ('vscode.python'):
                return (await this.json()).project.name;
            default:
                throw new Error(`Unexpected project type: ${await this.type}`);
        }
    }

    async slot() {
        // return the 1-indexed slot number
        switch (await this.type) {
            case ('iqpython'):
                return (await this.json()).slot + 1;
            case ('vscode.python'):
                return (await this.json()).project.slot;
            default:
                throw new Error(`Unexpected project type: ${await this.type}`);
        }
    }

    async slotIndex() {
        // return the 0-indexed slot number
        return (await this.slot()) - 1;
    }

    /*
        @param newSlot {Number} 1-indexed
    */
    async setSlot(newSlot) {
        const jsonHandle = await this.jsonHandle();
        const dict = await this.json();
        let jsonString = '';
        switch (await this.type) {
            case ('iqpython'):
                dict.slot = newSlot - 1;
                jsonString = JSON.stringify(dict);
                break;
            case ('vscode.python'):
                dict.project.slot = newSlot;
                jsonString = JSON.stringify(dict, null, '\t');
                break;
            default:
                throw new Error(`Unexpected project type: ${await this.type}`);
        }
        const writable = await jsonHandle.createWritable();
        await writable.write(jsonString);
        await writable.close();
    }

    async programText() {
        switch (await this.type) {
            case ('iqpython'):
                return (await this.json()).textContent;
            case ('vscode.python'):
                const relativePath = (await this.json()).project.python.main;
                const parts = relativePath.split('/').filter(Boolean);
                let currentDir = this.handle;
                for (let i = 0; i < parts.length - 1; i++) {
                    currentDir = await currentDir.getDirectoryHandle(parts[i]);
                }
                const fileHandle = await currentDir.getFileHandle(parts.at(-1));
                const file = await fileHandle.getFile();
                return await file.text();
            default:
                throw new Error(`Unexpected project type: ${await this.type}`);
        }
    }
}
