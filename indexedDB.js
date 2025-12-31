let dbPromise;

function getDB() {
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
    return dbPromise;
}

async function putData(key, data) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');

        store.put(data, key);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
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

async function delData(key) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');

        const req = store.delete(key);

        tx.oncomplete = () => {
            resolve();
        };
        tx.onerror = () => reject(tx.error);
    });
}
