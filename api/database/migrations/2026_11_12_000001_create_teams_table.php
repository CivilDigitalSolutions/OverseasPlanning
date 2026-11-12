<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Teams (owner, 2026-11-12): the team dropdown, managed by Administrators. Names unique ignoring case. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('teams', function (Blueprint $t) {
            $t->ulid('id')->primary();
            $t->string('name', 40);
            $t->string('created_by', 26);
            $t->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX teams_name_lower_unique ON teams (lower(name))');
    }

    public function down(): void
    {
        Schema::dropIfExists('teams');
    }
};
