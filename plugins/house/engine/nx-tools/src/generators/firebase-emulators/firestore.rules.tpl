rules_version = '2';

// {{seedMarker}} — delete this line once these rules are yours. Until then `nx run firebase:deploy` SKIPS this
// file, so the house's placeholder never reaches production (nor overwrites rules someone keeps in the console).
//
// DENY EVERYTHING — the safe default, seeded when the Firebase layer was added. Write the rules your app needs
// below; the emulators enforce this file too, so a client read or write fails locally until a rule allows it —
// which is the point: you test your rules where you write them. (Emulator seed data is written with the
// emulator's admin bypass, so seeding is unaffected.)
//
// Already have rules in the Firebase console? Pull the live ones in instead (it asks before overwriting this file):
//   npx firebase init firestore -P <alias>
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
