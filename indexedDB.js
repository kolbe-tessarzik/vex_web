let dbPromise;

function getDB() {
    console.log('Accessing IndexedDB');
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open('app-db', 3);

            req.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('handles')) {
                    db.createObjectStore('handles');
                }
            };

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => {
                console.warn('Failed to open IndexedDB:', req.error);
                reject(req.error);
            };
        });
    }
    console.log('IndexedDB accessed');
    return dbPromise;
}

async function getPermission(handle) {
    if (!handle) return false;

    const opts = { mode: 'readwrite' };

    
    if (await handle.queryPermission(opts) === 'granted') {
        return true;
    }

    return (await handle.requestPermission(opts)) === 'granted';
}


async function putHandle(key, handle) {
    const db = await getDB();
    console.log("IndexedDB:", db);
    return new Promise((resolve, reject) => {
        console.log(`Storing handle for key: ${key}`);
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');

        store.put(handle, key);

        tx.oncomplete = () => {
            console.log(`Stored data for key: ${key}`);
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}

async function getHandle(key) {
    const result = await getData(key);

    return (await getPermission(result)) ? result : null;
}

async function putData(key, handle) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        console.log(`Storing data for key: ${key}`);
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');

        store.put(handle, key);

        tx.oncomplete = () => {
            console.log(`Stored data for key: ${key}`);
            resolve();
        };
        tx.onerror = () => {throw tx.error;};
    });
}

async function getData(key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction('handles', 'readonly');
            const store = tx.objectStore('handles');
            const req = store.get(key);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (error) {
            console.warn('Error accessing IndexedDB:', error);
            resolve(undefined);
        }
    });
}

