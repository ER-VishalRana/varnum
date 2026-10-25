# Varnum: Android app

Write in English and get the letter in Hindi or 20+ languages as you type. Also edits PowerPoint and PDF files. This is the Android version of the Varnum web app, built with Capacitor.

## What is inside
- `www/`: the app itself (the same app as the web version, with its libraries stored locally so it opens without internet)
- `android/`: the Android Studio project
- `.github/workflows/android.yml`: builds the app on GitHub for free every time you push

## Translation (free)
- **On the phone, offline:** Google ML Kit. The first time a language is used, the app downloads a language pack of about 30 MB. After that it works without internet. It covers Hindi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Urdu, English and 50+ more.
- **Punjabi, Odia, Malayalam, Nepali and Sanskrit** are not in ML Kit. For these the app uses the free MyMemory service, which needs internet.
- **Optional Gemini key** (free from https://aistudio.google.com/apikey): paste it under **AI settings** in the app. It unlocks formal letter style, Fix my English, Photo to text and Hinglish typing.

## Get the APK (no software needed on your computer)
1. Create a new repository on github.com, for example `varnum-android`. It can be private.
2. Upload everything in this folder to it. Either tell Claude the repository name so Claude can push it, or use **Add file → Upload files** on GitHub.
3. Open the **Actions** tab. The "Build Android app" run takes about 5–8 minutes.
4. Open the finished run. Under **Artifacts**, download **varnum-apk**. Unzip it to get `app-debug.apk`.
5. Send the APK to your phone and open it. Android will ask you to allow installing from this source.

This test APK is for you and testers. The Play Store needs a signed bundle (below).

## Later: publish on the Play Store
1. Pay the one-time Google Play developer fee ($25, about ₹2,100) at https://play.google.com/console.
2. Create a signing key once. With Java installed, run:
   `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias varnum`
   Keep `release.jks` and its passwords safe. If you lose them, you cannot update the app.
3. In the GitHub repository, go to **Settings → Secrets and variables → Actions** and add:
   - `ANDROID_KEYSTORE_BASE64`: the output of `base64 -w0 release.jks`
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`varnum`), `ANDROID_KEY_PASSWORD`
4. Run the workflow again. It now also produces **varnum-play-store-bundle** (`app-release.aab`). Upload this file in the Play Console.
5. Raise `versionCode` and `versionName` in `android/app/build.gradle` for every new release.

## Changing the app
Edit `www/index.html`, then push. GitHub builds a new APK. To build on your own computer instead, install Node 20, Java 21 and Android Studio, then run `npm install`, `npx cap sync android` and `npx cap open android`.

## Chrome / website version
The `web/` folder is the same app as a website that runs in Chrome and can be installed from the browser. See `web/README.md` for free hosting with GitHub Pages or Netlify.

## Website (varnum.alvvintechnology.com, hosted on Jarvis)
- `/` is the product website (`site/`), `/app/` is the web app (`web/`), `/download/varnum.apk` is the Android app.
- Every push to `main` builds the APK on GitHub Actions and uploads it to the public `apk-latest` release.
- `node scripts/build-site.mjs` puts all of it into `dist/` (it downloads the APK from that release).
- Publish on Jarvis (production, deploy only): `ssh jarvis 'publish-site Varnum'`.
