<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Voyager Trip Manager schema (docs/MIGRATION-PLAN.md §4). Every author/time column is written by
 * the server. Audit tables (agreements, role_changes, audit_logs, security_events) have NO foreign
 * keys so an account can be deleted without touching them, and are append-only via triggers.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('agreements', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('user_id', 26)->index();
            $t->string('email', 254)->nullable();
            $t->string('terms_version', 40);
            $t->string('privacy_version', 40);
            $t->string('method', 20);
            $t->string('ip', 64);
            $t->string('user_agent', 400);
            $t->timestampTz('accepted_at')->useCurrent();
        });
        Schema::create('role_changes', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('user_id', 26)->index();
            $t->string('email', 254)->nullable();
            $t->jsonb('changes');
            $t->string('by_user_id', 26);
            $t->timestampTz('created_at')->useCurrent();
        });
        Schema::create('audit_logs', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('actor_id', 26)->nullable()->index();
            $t->string('method', 10);
            $t->string('route', 120);
            $t->string('trip_id', 26)->nullable()->index();
            $t->unsignedSmallInteger('status');
            $t->string('ip', 64);
            $t->string('user_agent', 400)->nullable();
            $t->string('request_id', 64)->nullable();
            $t->timestampTz('created_at')->useCurrent()->index();
        });
        Schema::create('security_events', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('user_id', 26)->nullable()->index();
            $t->string('email', 254)->nullable();
            $t->string('type', 60)->index();
            $t->jsonb('detail')->nullable();
            $t->string('ip', 64)->nullable();
            $t->string('action_taken', 60)->nullable();
            $t->timestampTz('created_at')->useCurrent()->index();
        });

        Schema::create('passkeys', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $t->string('credential_id', 512)->unique();
            $t->text('public_key');
            $t->unsignedBigInteger('sign_count')->default(0);
            $t->string('label', 60);
            $t->timestampTz('last_used_at')->nullable();
            $t->timestampsTz();
        });

        Schema::create('trip_requests', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('team_name', 80);
            $t->string('start_date', 10);
            $t->string('end_date', 10);
            $t->string('location', 120);
            $t->string('requester_id', 26)->index();
            $t->string('requester_name', 80);
            $t->string('requester_email', 254);
            $t->string('status', 12)->default('submitted');
            $t->string('decline_reason', 500)->default('');
            $t->string('trip_id', 26)->nullable();
            $t->string('decided_by', 26)->nullable();
            $t->timestampTz('decided_at')->nullable();
            $t->timestampsTz();
        });

        Schema::create('trips', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('name', 120);
            $t->string('team_name', 80);
            $t->string('location', 120);
            $t->string('start_date', 10);
            $t->string('end_date', 10);
            $t->string('status', 10)->default('planning')->index();
            $t->string('cyber_risk', 10);
            $t->text('cyber_rationale');
            $t->string('country_risk', 10);
            $t->text('country_rationale');
            $t->string('dip_classification', 10)->default('');
            $t->boolean('dip_agreed')->default(false);
            $t->string('dip_agreed_date', 10)->default('');
            $t->jsonb('roles')->default('{}');
            $t->jsonb('extra_access_uids')->default('[]');
            $t->jsonb('extra_access_emails')->default('[]');
            $t->string('request_id', 26)->nullable();
            $t->string('requester_id', 26)->nullable();
            $t->string('created_by', 26);
            $t->string('created_by_name', 80)->default('');
            $t->string('created_by_email', 254)->default('');
            $t->string('updated_by', 26)->nullable();
            $t->string('updated_by_name', 80)->default('');
            $t->timestampsTz();
        });

        // Who is on a trip and why — written ONLY by App\Services\Membership.
        Schema::create('trip_members', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $t->string('name', 80)->default('');
            $t->string('email', 254)->default('');
            $t->jsonb('reasons');
            $t->timestampTz('added_at')->useCurrent();
            $t->primary(['trip_id', 'user_id']);
            $t->index('user_id');
        });
        Schema::create('trip_pending_emails', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('email', 254)->index();
            $t->primary(['trip_id', 'email']);
        });

        Schema::create('trip_items', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('kind', 10);
            $t->jsonb('values');
            $t->string('spc_decision', 14)->nullable();
            $t->text('spc_rationale')->nullable();
            $t->string('spc_decided_by', 26)->nullable();
            $t->string('spc_decided_by_name', 80)->nullable();
            $t->timestampTz('spc_decided_at')->nullable();
            $t->string('created_by', 26);
            $t->string('created_by_name', 80)->default('');
            $t->string('updated_by', 26)->nullable();
            $t->timestampsTz();
            $t->index(['trip_id', 'kind']);
        });

        Schema::create('messages', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('sender_id', 26);
            $t->string('sender_name', 80)->default('');
            $t->text('text');
            $t->timestampTz('created_at')->useCurrent();
            $t->index(['trip_id', 'created_at']);
        });

        Schema::create('attachments', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('name', 200);
            $t->string('disk_path', 300);
            $t->unsignedBigInteger('size');
            $t->string('content_type', 120);
            $t->string('uploaded_by', 26);
            $t->string('uploaded_by_name', 80)->default('');
            $t->timestampTz('created_at')->useCurrent();
        });

        Schema::create('tl_requests', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('kind', 10);
            $t->string('title', 120);
            $t->text('details');
            $t->unsignedInteger('quantity')->nullable();
            $t->decimal('amount', 12, 2)->nullable();
            $t->string('currency', 10)->default('');
            $t->string('needed_by', 10)->default('');
            $t->string('status', 10)->default('pending');
            $t->string('created_by', 26);
            $t->string('created_by_name', 80)->default('');
            $t->string('decided_by', 26)->nullable();
            $t->string('decided_by_name', 80)->nullable();
            $t->timestampTz('decided_at')->nullable();
            $t->string('decision_note', 1000)->nullable();
            $t->timestampsTz();
        });

        Schema::create('summaries', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('role', 12);
            $t->text('text');
            $t->string('by_user_id', 26);
            $t->string('by_name', 80)->default('');
            $t->timestampTz('updated_at')->useCurrent();
            $t->primary(['trip_id', 'role']);
        });

        Schema::create('contacts', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('name', 80);
            $t->string('organisation', 120)->default('');
            $t->string('job_title', 80)->default('');
            $t->string('email', 254)->default('');
            $t->string('phone', 40)->default('');
            $t->string('country', 80)->default('');
            $t->text('notes');
            $t->string('created_by', 26);
            $t->string('created_by_name', 80)->default('');
            $t->timestampsTz();
        });
        Schema::create('trip_contacts', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('contact_id', 26);
            $t->string('name', 80);
            $t->string('organisation', 120)->default('');
            $t->string('job_title', 80)->default('');
            $t->string('email', 254)->default('');
            $t->string('phone', 40)->default('');
            $t->string('country', 80)->default('');
            $t->string('trip_role', 80)->default('');
            $t->string('added_by', 26);
            $t->string('added_by_name', 80)->default('');
            $t->timestampTz('added_at')->useCurrent();
            $t->primary(['trip_id', 'contact_id']);
        });

        // Health data: vaccines and notes are encrypted by the application (Crypt, APP_KEY).
        Schema::create('vaccinations', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $t->string('name', 80)->default('');
            $t->text('vaccines_enc');
            $t->text('notes_enc');
            $t->boolean('declared')->default(false);
            $t->timestampTz('declared_at')->nullable();
            $t->timestampTz('updated_at')->useCurrent();
            $t->primary(['trip_id', 'user_id']);
        });

        // Welfare concerns and injury references are encrypted by the application.
        Schema::create('debriefs', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->primary()->constrained()->cascadeOnDelete();
            $t->text('went_well');
            $t->text('could_be_better');
            $t->text('welfare_concerns_enc');
            $t->text('injury_refs_enc');
            $t->boolean('reciprocity_issues')->default(false);
            $t->text('reciprocity_description');
            $t->string('updated_by', 26);
            $t->string('updated_by_name', 80)->default('');
            $t->timestampTz('updated_at')->useCurrent();
        });

        Schema::create('finance_entries', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('owner_id', 26);
            $t->string('owner_name', 80)->default('');
            $t->string('date', 10)->default('');
            $t->string('category', 40)->default('');
            $t->string('description', 200);
            $t->decimal('amount', 12, 2);
            $t->string('currency', 10);
            $t->string('payment_method', 40)->default('');
            $t->string('receipt_ref', 60)->default('');
            $t->timestampsTz();
        });
        Schema::create('finance_notes', function (Blueprint $t) {
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->string('user_id', 26);
            $t->string('name', 80)->default('');
            $t->text('text');
            $t->timestampTz('updated_at')->useCurrent();
            $t->primary(['trip_id', 'user_id']);
        });

        Schema::create('trip_reads', function (Blueprint $t) {
            $t->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $t->foreignUlid('trip_id')->constrained()->cascadeOnDelete();
            $t->timestampTz('read_at')->useCurrent();
            $t->primary(['user_id', 'trip_id']);
        });

        Schema::create('app_notifications', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $t->string('type', 20);
            $t->string('title', 200);
            $t->string('body', 400);
            $t->string('trip_id', 26)->default('');
            $t->string('link', 200)->default('');
            $t->boolean('read')->default(false);
            $t->timestampTz('created_at')->useCurrent();
            $t->index(['user_id', 'created_at']);
        });

        Schema::create('push_subscriptions', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $t->text('endpoint');
            $t->string('endpoint_hash', 64)->unique();
            $t->string('p256dh', 200);
            $t->string('auth', 100);
            $t->string('user_agent', 200)->default('');
            $t->timestampsTz();
        });

        // Append-only: refuse UPDATE and DELETE on the audit tables at the database itself, so even
        // a bug or a compromised application account cannot rewrite history (SECURITY-PLAN T5).
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared(<<<'SQL'
                CREATE OR REPLACE FUNCTION voyager_append_only() RETURNS trigger AS $$
                BEGIN
                  RAISE EXCEPTION 'append-only table: % on % refused', TG_OP, TG_TABLE_NAME;
                END;
                $$ LANGUAGE plpgsql;
            SQL);
            foreach (['agreements', 'role_changes', 'audit_logs', 'security_events'] as $table) {
                DB::unprepared("CREATE TRIGGER {$table}_append_only BEFORE UPDATE OR DELETE ON {$table} FOR EACH ROW EXECUTE FUNCTION voyager_append_only();");
            }
        }
    }

    public function down(): void
    {
        foreach ([
            'push_subscriptions', 'app_notifications', 'trip_reads', 'finance_notes', 'finance_entries', 'debriefs', 'vaccinations',
            'trip_contacts', 'contacts', 'summaries', 'tl_requests', 'attachments', 'messages', 'trip_items', 'trip_pending_emails',
            'trip_members', 'trips', 'trip_requests', 'passkeys', 'security_events', 'audit_logs', 'role_changes', 'agreements',
        ] as $table) {
            Schema::dropIfExists($table);
        }
        if (DB::getDriverName() === 'pgsql') {
            DB::unprepared('DROP FUNCTION IF EXISTS voyager_append_only() CASCADE;');
        }
    }
};
