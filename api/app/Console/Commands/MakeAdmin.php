<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Notifications\ResetPasswordLink;
use App\Support\Clean;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;

/**
 * Bootstraps the FIRST administrator (after that, administrators use the account manager in the
 * app). Run on the server: php artisan voyager:make-admin someone@org --name="Their Name"
 * The person receives a set-password email; the command never prints a password or link.
 */
class MakeAdmin extends Command
{
    protected $signature = 'voyager:make-admin {email} {--name=} {--host : also give the HOST profile}';

    protected $description = 'Create or promote an Administrator account';

    public function handle(): int
    {
        $email = Clean::email($this->argument('email'));
        if (!$email) {
            $this->error('Enter a valid email.');
            return self::FAILURE;
        }
        $user = User::where('email', $email)->first();
        $created = false;
        if (!$user) {
            $user = new User(['name' => Clean::text($this->option('name') ?: explode('@', $email)[0], 80), 'email' => $email]);
            $user->forceFill(['email_verified_at' => now()]);
            $created = true;
        }
        $user->forceFill(['is_admin' => true, 'is_host' => $user->is_host || $this->option('host')])->save();
        DB::table('role_changes')->insert([
            'id' => (string) Str::ulid(), 'user_id' => $user->id, 'email' => $email,
            'changes' => json_encode(['created' => $created, 'roles' => $user->roleProfiles(), 'via' => 'console']), 'by_user_id' => 'console',
        ]);
        if ($created) {
            $user->notify(new ResetPasswordLink(Password::broker()->createToken($user), true));
        }
        $this->info(($created ? 'Created' : 'Updated') . " administrator {$email}." . ($created ? ' A set-password email has been sent.' : ''));
        return self::SUCCESS;
    }
}
