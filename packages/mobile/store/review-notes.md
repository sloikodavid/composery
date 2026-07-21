# Store review notes template

Replace uppercase placeholders in the private App Store Connect / Play Console
fields. Do not replace them in Git.

```text
Composery Mobile is a native client for an existing Composery instance. It does
not sell access or link to a purchase flow.

Review URL: REVIEW_URL
Credentials: REVIEW_CREDENTIALS
Static QR: attached privately to this submission; it resolves to REVIEW_URL.

Steps:
1. Start the app and choose Scan QR code, or choose Add instance.
2. Scan the attached QR / enter REVIEW_URL.
3. Keep the suggested label and choose Add.
4. Open the saved instance.
5. Sign in with REVIEW_CREDENTIALS if prompted.
6. Open the sample workspace and terminal.
7. Use the native back action to close an IDE layer, then return to the instance list.

Native functionality includes local instance management, QR scanning with a
manual-entry fallback, haptics, native back/navigation integration, system theme
and safe-area handling, keyboard handling, background/process recovery, and
direct local/self-hosted access. A direct /_composery marker is required before
an instance is displayed. Top-level links outside the verified instance origin
and mount path open through the operating system instead of the WebView.

Camera permission is optional and used only to decode QR codes on device. The
app does not request microphone, storage, location, contacts, advertising, or
tracking permission.
```

Before pasting, test these instructions from a signed-out physical device using
the exact submitted build. Verify the credential never requires OTP, invitation,
payment, IP allowlisting, or staff intervention.
