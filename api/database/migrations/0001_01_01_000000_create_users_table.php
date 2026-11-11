<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Accounts. Role profiles (is_host, is_controller, is_spc, is_admin) replace Firebase custom claims
 * and are written ONLY by the administrator endpoints (never mass-assignable — App\Models\User).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('name', 80);
            $t->string('email', 254)->unique();
            $t->timestampTz('email_verified_at')->nullable();
            $t->string('password')->nullable();
            $t->boolean('is_host')->default(false);
            $t->boolean('is_controller')->default(false);
            $t->boolean('is_spc')->default(false);
            $t->boolean('is_admin')->default(false);
            $t->string('terms_version', 40)->nullable();
            $t->string('privacy_version', 40)->nullable();
            $t->timestampTz('last_agreement_at')->nullable();
            $t->timestampTz('last_login_at')->nullable();
            $t->timestampTz('disabled_at')->nullable();
            $t->string('created_by_admin', 26)->nullable();
            $t->rememberToken();
            $t->timestampsTz();
        });

        Schema::create('password_reset_tokens', function (Blueprint $t) {
            $t->string('email')->primary();
            $t->string('token');
            $t->timestampTz('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('user_id', 26)->nullable()->index();
            $t->string('ip_address', 45)->nullable();
            $t->text('user_agent')->nullable();
            $t->longText('payload');
            $t->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};
