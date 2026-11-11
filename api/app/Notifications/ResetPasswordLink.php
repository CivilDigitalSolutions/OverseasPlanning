<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Password reset / first-time set-password link (opens the PWA's /auth/action screen). */
class ResetPasswordLink extends Notification
{
    public function __construct(#[\SensitiveParameter] private readonly string $token, private readonly bool $firstTime = false)
    {
    }

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $link = rtrim((string) config('app.url'), '/') . '/auth/action?' . http_build_query([
            'mode' => 'resetPassword', 'token' => $this->token, 'email' => $notifiable->getEmailForPasswordReset(),
        ]);
        $minutes = (int) config('auth.passwords.users.expire', 60);

        return (new MailMessage())
            ->subject($this->firstTime ? 'Your Voyager Trip Manager account' : 'Reset your password — Voyager Trip Manager')
            ->line($this->firstTime ? 'An account has been created for you. Set a password to sign in.' : 'Use this link to choose a new password.')
            ->action('Set password', $link)
            ->line("The link works for {$minutes} minutes. If you did not ask for this, ignore this email.");
    }
}
