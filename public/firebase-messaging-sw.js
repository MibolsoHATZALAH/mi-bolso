/* Receives push alarms while the app is closed (scope: /mi-bolso/, both apps).
   Alarms are sent by the daily job (scripts/alarmas.ts) with a notification + link;
   the Firebase SDK shows them and opens the link when tapped. */
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBeBDv_KcIOCTjuqajjXSDLXxGJUo0bBU0",
  authDomain: "mibolsohatzalah.firebaseapp.com",
  projectId: "mibolsohatzalah",
  storageBucket: "mibolsohatzalah.firebasestorage.app",
  messagingSenderId: "783360125991",
  appId: "1:783360125991:web:cd6971d08cd5aad58fb202",
});
firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
