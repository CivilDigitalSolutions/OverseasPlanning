<?php

namespace App\Models;

use App\Notifications\ResetPasswordLink;
use App\Notifications\VerifyEmailLink;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

/**
 * An account. Only name/email/password are fillable: role profiles, verification and agreement
 * fields are set explicitly by the server (SECURITY-PLAN T4 — no mass assignment of roles).
 *
 * @property string $id
 * @property string $name
 * @property string $email
 * @property bool $is_host
 * @property bool $is_controller
 * @property bool $is_spc
 * @property bool $is_admin
 * @property \Illuminate\Support\Carbon|null $email_verified_at
 * @property \Illuminate\Support\Carbon|null $disabled_at
 * @property \Illuminate\Support\Carbon|null $last_login_at
 */
class User extends Authenticatable implements MustVerifyEmail
{
    use HasUlids;
    use Notifiable;

    protected $fillable = ['name', 'email', 'password'];

    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_agreement_at' => 'datetime',
            'last_login_at' => 'datetime',
            'disabled_at' => 'datetime',
            'password' => 'hashed',
            'is_host' => 'boolean',
            'is_controller' => 'boolean',
            'is_spc' => 'boolean',
            'is_admin' => 'boolean',
        ];
    }

    public function isVerified(): bool
    {
        return $this->email_verified_at !== null;
    }

    /** @return array{host: bool, controller: bool, spc: bool, admin: bool} */
    public function roleProfiles(): array
    {
        return ['host' => $this->is_host, 'controller' => $this->is_controller, 'spc' => $this->is_spc, 'admin' => $this->is_admin];
    }

    public function sendEmailVerificationNotification(): void
    {
        $this->notify(new VerifyEmailLink());
    }

    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        $this->notify(new ResetPasswordLink($token));
    }
}
