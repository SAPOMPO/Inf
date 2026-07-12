import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, push } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7gZc0nw1puTENxejNeSaB0d3Jllt01Ac",
  authDomain: "fir-90ac4.firebaseapp.com",
  databaseURL: "https://fir-90ac4-default-rtdb.firebaseio.com",
  projectId: "fir-90ac4",
  storageBucket: "fir-90ac4.firebasestorage.app",
  messagingSenderId: "621219147598",
  appId: "1:621219147598:web:6c87abefcdf3655709781f",
  measurementId: "G-FF2N68E3XM"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export { ref, push };