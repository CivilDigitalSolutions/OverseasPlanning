<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;

/**
 * Email confirmation link. The link opens the PWA's /auth/action screen, which posts the signed
 * parameters back to the API — the signature is the proof, so it works on any device, signed in
 * or not (MIGRATION-PLAN review item 13). Valid for 60 minutes.
 */
class VerifyEmailLink extends Notification
{
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $signed = URL::temporarySignedRoute('verification.verify', now()->addMinutes(60), [
            'id' => $notifiable->getKey(), 'hash' => sha1($notifiable->getEmailForVerification()),
        ]);
        parse_str((string) parse_url($signed, PHP_URL_QUERY), $q);
        $link = rtrim((string) config('app.url'), '/') . '/auth/action?' . http_build_query([
            'mode' => 'verifyEmail', 'id' => $notifiable->getKey(), 'hash' => sha1($notifiable->getEmailForVerification()),
            'expires' => $q['expires'] ?? '', 'signature' => $q['signature'] ?? '',
        ]);

        return (new MailMessage())
            ->subject('Confirm your email — Voyager Trip Manager')
            ->line('Confirm your email address to start using Voyager Trip Manager.')
            ->action('Confirm email', $link)
            ->line('The link works for 60 minutes. If you did not create an account, ignore this email.');
    }
}
