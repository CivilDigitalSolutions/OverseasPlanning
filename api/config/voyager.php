<?php

return [
    // Versions of the Terms and Privacy Policy the person agrees to at every sign-in.
    // TODO(owner): bump when the documents are written (spec §2a/§2b); keep web/src/model.ts in step.
    'terms_version' => env('TERMS_VERSION', 'draft-0'),
    'privacy_version' => env('PRIVACY_VERSION', 'draft-0'),
    // Passkeys: the app's own domain (no scheme), e.g. voyager.example.org. TODO(owner): production domain.
    'passkey_rp_id' => env('PASSKEY_RP_ID', 'localhost'),
    'rp_name' => 'Voyager Trip Manager',
];
