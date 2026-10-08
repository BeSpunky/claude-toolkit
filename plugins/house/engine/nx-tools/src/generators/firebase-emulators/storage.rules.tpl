rules_version = '2';

// {{seedMarker}} — delete this line once these rules are yours. Until then `nx run firebase:deploy` SKIPS this
// file, so the house's placeholder never reaches production (nor overwrites rules someone keeps in the console).
//
// DENY EVERYTHING — the safe default, seeded when the Firebase layer was added. Write the rules your app needs
// below; the Storage emulator enforces this file too, so an upload or download fails locally until a rule allows it.
//
// Already have rules in the Firebase console? Pull the live ones in instead (it asks before overwriting this file):
//   npx firebase init storage -P <alias>
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
