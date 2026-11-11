<?php

namespace App\Support;

/**
 * Pure input checks, ported from functions/src/lib/validate.ts (keep the two in step until the
 * Firebase backend is retired).
 */
final class Clean
{
    public const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];
    public const ROLE_KEYS = ['teamLeader', 'officeManager', 'spc', 'intelWorker'];
    public const ROLE_LABELS = ['teamLeader' => 'Team Leader', 'officeManager' => 'Office Manager', 'spc' => 'SPC', 'intelWorker' => 'Intel Worker'];
    public const DIP_CLASSIFICATIONS = ['PSA', 'CP', 'Reece', 'Event'];
    public const TRIP_STATUSES = ['planning', 'live', 'archived'];
    public const REQUEST_KINDS = ['resource', 'flight', 'hotel', 'car', 'taxi', 'asset', 'cash'];
    public const AGREEMENT_METHODS = ['signup', 'password', 'passkey'];
    public const ID_RE = '/^[A-Za-z0-9_-]{1,64}$/';

    public static function email(mixed $raw): ?string
    {
        if (!is_string($raw)) {
            return null;
        }
        $e = strtolower(trim($raw));
        return strlen($e) <= 254 && preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $e) ? $e : null;
    }

    /** Strip control characters (keep tab/newline), trim, cut to $max characters. */
    public static function text(mixed $raw, int $max): string
    {
        if (!is_string($raw)) {
            return '';
        }
        $s = preg_replace('/[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}]/u', '', $raw) ?? '';
        return mb_substr(trim($s), 0, $max);
    }

    public static function isId(mixed $raw): bool
    {
        return is_string($raw) && preg_match(self::ID_RE, $raw) === 1 && !preg_match('/^__.*__$/', $raw);
    }

    public static function isDate(mixed $raw): bool
    {
        if (!is_string($raw) || !preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $raw, $m)) {
            return false;
        }
        return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
    }

    /**
     * Roles map → only known keys, each with a valid email (name may be blank → email prefix).
     * @return array{0: array<string, array{name: string, email: string}>, 1: ?string}
     */
    public static function roles(mixed $raw): array
    {
        $roles = [];
        if ($raw === null) {
            return [$roles, null];
        }
        if (!is_array($raw) || array_is_list($raw) && $raw !== []) {
            return [$roles, 'Roles are invalid.'];
        }
        foreach ($raw as $k => $v) {
            if (!in_array($k, self::ROLE_KEYS, true)) {
                return [$roles, "Unknown role {$k}."];
            }
            $r = is_array($v) ? $v : [];
            $name = self::text($r['name'] ?? '', 80);
            $rawEmail = is_string($r['email'] ?? null) ? trim($r['email']) : '';
            if ($rawEmail === '' && $name === '') {
                continue;
            }
            $email = $rawEmail !== '' ? self::email($rawEmail) : '';
            if ($email === null) {
                return [$roles, "Enter a valid email for {$k}."];
            }
            $roles[$k] = ['name' => $name !== '' ? $name : ($email !== '' ? explode('@', $email)[0] : ''), 'email' => $email];
        }
        return [$roles, null];
    }

    /** @return array{level: string, rationale: string} */
    public static function risk(mixed $level, mixed $rationale, string $label): array
    {
        if (!is_string($level) || !in_array($level, self::RISK_LEVELS, true)) {
            throw new \InvalidArgumentException("Choose a {$label} risk level.");
        }
        $r = self::text($rationale, 2000);
        if ($r === '') {
            throw new \InvalidArgumentException("Enter a {$label} risk rationale.");
        }
        return ['level' => $level, 'rationale' => $r];
    }

    /** The Live trips window (spec: not archived; marked live or starting within 10 days). */
    public static function isLive(?string $status, ?string $startDate, ?int $nowMs = null): bool
    {
        if ($status === 'archived') {
            return false;
        }
        if ($status === 'live') {
            return true;
        }
        if (!self::isDate($startDate)) {
            return false;
        }
        $now = $nowMs ?? (int) floor(microtime(true) * 1000);
        $start = strtotime($startDate . 'T00:00:00Z') * 1000;
        return $start <= $now + 10 * 86400000;
    }
}
