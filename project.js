class Project {
    constructor(path, handle) {
        this.path = path;
        this.handle = handle;
        if (handle.name.endsWith('.iqpython'))
        {
            if (!(handle instanceof FileSystemFileHandle)) {
                throw new TypeError("Expected a FileSystemFileHandle");
            }
            this.type = 'iqpython';
        } else {
            if (!(handle instanceof FileSystemDirectoryHandle)) {
                throw new TypeError("Expected a FileSystemDirectoryHandle");
            }
            this.type = 'vscode';
        }
    }

    async info() {
        return {
            name: await this.name(),
            path: this.path,
            slot: await this.slot(),
            handle: this.handle,
        };
    }

    static fromStored(obj) {
        return new Project(obj.path, obj.handle);
    }

    /*
    * @returns {FileSystemFileHandle} jsonHandle
    */
    async jsonHandle() {
        switch (this.type) {
            case ('iqpython'):
                return this.handle;
            case ('vscode'):
                return await (await this.handle.getDirectoryHandle('.vscode')).getFileHandle('vex_project_settings.json');
            default:
                throw new Error(`Unexpected project type: ${this.type}`);
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
        switch (this.type) {
            case ('iqpython'):
                return this.handle.name.slice(0, -9);
            case ('vscode'):
                return (await this.json()).project.name;
            default:
                throw new Error(`Unexpected project type: ${this.type}`);
        }
    }

    async slot() {
        // return the 1-indexed slot number
        switch (this.type) {
            case ('iqpython'):
                return (await this.json()).slot + 1;
            case ('vscode'):
                return (await this.json()).project.slot;
            default:
                throw new Error(`Unexpected project type: ${this.type}`);
        }
    }

    /*
        @param newSlot {Number} 1-indexed
    */
    async setSlot(newSlot) {
        const jsonHandle = await this.jsonHandle();
        const dict = await this.json();
        let jsonString = '';
        switch (this.type) {
            case ('iqpython'):
                dict.slot = newSlot - 1;
                jsonString = JSON.stringify(dict);
                break;
            case ('vscode'):
                dict.project.slot = newSlot;
                jsonString = JSON.stringify(dict, null, '\t');
                break;
            default:
                throw new Error(`Unexpected project type: ${this.type}`);
        }
        const writable = await jsonHandle.createWritable();
        await writable.write(jsonString);
        await writable.close();
    }

    async programText() {
        switch (this.type) {
            case ('iqpython'):
                return (await this.json()).textContent;
            case ('vscode'):
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
                throw new Error(`Unrecognized handle kind: ${handle.kind}`);
        }
    }
}
