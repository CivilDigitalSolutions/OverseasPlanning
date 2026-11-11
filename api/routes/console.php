<?php

use Illuminate\Support\Facades\Schedule;

// Run by the scheduler task in AWS (`php artisan schedule:work` or an EventBridge rule).
Schedule::command('voyager:prune')->dailyAt('03:15');
