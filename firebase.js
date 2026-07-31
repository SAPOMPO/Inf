import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
    getFirestore, 
    enableIndexedDbPersistence, 
    doc, 
    collection, 
    writeBatch, 
    onSnapshot, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDocs, 
    setDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD7gZc0nw1puTENxejNeSaB0d3Jllt01Ac",
    authDomain: "fir-90ac4.firebaseapp.com",
    projectId: "fir-90ac4",
    storageBucket: "fir-90ac4.firebasestorage.app",
    messagingSenderId: "621219147598",
    appId: "1:621219147598:web:6c87abefcdf3655709781f"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
        const warningState = { status: "Multiple tabs open", active: true };
        window.sessionStorage.setItem("persistenceWarning", JSON.stringify(warningState));
    } else if (err.code === 'unimplemented') {
        const warningState = { status: "Not supported", active: true };
        window.sessionStorage.setItem("persistenceWarning", JSON.stringify(warningState));
    }
});

export { 
    db, 
    doc, 
    collection, 
    writeBatch, 
    onSnapshot, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDocs, 
    setDoc 
};