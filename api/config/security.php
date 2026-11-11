<?php

/*
| Security settings (docs/SECURITY-PLAN.md). Values marked TODO(owner) are defaults waiting for the
| organisation's own policy; change them here or through the environment.
*/
return [
    'session' => [
        // TODO(owner): idle and absolute session lifetimes from the organisation's policy.
        'idle_minutes' => (int) env('SESSION_IDLE_MINUTES', 30),
        'absolute_hours' => (int) env('SESSION_ABSOLUTE_HOURS', 12),
    ],
    'password' => [
        // Breached-password check (k-anonymity: only 5 hash characters leave the server). Fails open
        // if the service is unreachable (e.g. blocked by Zscaler) — SECURITY-PLAN R9.
        'breach_check' => (bool) env('PASSWORD_BREACH_CHECK', true),
    ],
    'rasp' => [
        // detect = record and alert only; protect = also disable the account and end its sessions.
        'mode' => env('SECURITY_RASP_MODE', 'detect'),
        'max_denials' => (int) env('SECURITY_RASP_MAX_DENIALS', 15),
        'max_trips' => (int) env('SECURITY_RASP_MAX_TRIPS', 40),
        'max_trips_privileged' => (int) env('SECURITY_RASP_MAX_TRIPS_PRIVILEGED', 200),
    ],
];
