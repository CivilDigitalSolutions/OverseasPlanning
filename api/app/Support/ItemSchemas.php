<?php

namespace App\Support;

/**
 * Server-side shape check for flights, hotels, hire cars and assets. Port of the `validItem`
 * allowlists in firestore.rules and the field lists in web/src/model.ts ITEM_SCHEMAS — keep all
 * three in step. The PWA sends values already cleaned by `cleanItem`; this refuses anything else.
 */
final class ItemSchemas
{
    public const KINDS = ['flights', 'hotels', 'cars', 'assets'];
    public const TRAVEL_CLASSES = ['First class', 'Business class', 'Premium economy', 'Economy', 'Charter flight', 'Other'];

    /** key => [type, options|max, required] */
    private const FIELDS = [
        'flights' => [
            'flightStatus' => ['select', ['Planning', 'Requested', 'Confirmed'], true],
            'flightType' => ['select', ['Outbound', 'Inbound', 'Onward', 'Connecting'], true],
            'airline' => ['text', 80, false],
            'flightNumber' => ['text', 20, true],
            'from' => ['text', 80, true],
            'departAt' => ['datetime', 20, false],
            'to' => ['text', 80, true],
            'arriveAt' => ['datetime', 20, false],
            'dayNight' => ['select', ['Day', 'Night'], false],
            'durationMinutes' => ['int', [1, 2880], false],
            'bookingRef' => ['text', 40, false],
            'cost' => ['money', null, false],
            'corporateTravel' => ['select', ['Yes', 'No'], true],
            'valueForMoney' => ['select', ['Yes', 'No'], true],
            'passengers' => ['passengers', 100, false],
            'notes' => ['text', 2000, false],
        ],
        'hotels' => [
            'name' => ['text', 120, true],
            'address' => ['text', 400, false],
            'city' => ['text', 80, false],
            'phone' => ['text', 40, false],
            'checkIn' => ['date', null, false],
            'checkOut' => ['date', null, false],
            'bookingRef' => ['text', 40, false],
            'cost' => ['money', null, false],
            'guests' => ['people', 100, false],
            'notes' => ['text', 2000, false],
        ],
        'cars' => [
            'company' => ['text', 80, true],
            'vehicle' => ['text', 80, false],
            'insuranceClass' => ['text', 60, false],
            'registration' => ['text', 20, false],
            'collectionLocation' => ['text', 160, false],
            'collectionDate' => ['date', null, false],
            'dropOffLocation' => ['text', 160, false],
            'dropOffDate' => ['date', null, false],
            'bookingRef' => ['text', 40, false],
            'cost' => ['money', null, false],
            'drivers' => ['people', 20, false],
            'notes' => ['text', 2000, false],
        ],
        'assets' => [
            'name' => ['text', 120, true],
            'category' => ['text', 60, false],
            'serialNumber' => ['text', 60, false],
            'quantity' => ['int', [0, 100000], false],
            'carriedBy' => ['text', 80, false],
            'returned' => ['bool', null, false],
            'notes' => ['text', 2000, false],
        ],
    ];

    /**
     * Validate and normalise an item's values. Returns [values, errors]; unknown keys are errors.
     * @return array{0: array<string, mixed>, 1: array<string, string>}
     */
    public static function check(string $kind, mixed $raw): array
    {
        $fields = self::FIELDS[$kind] ?? null;
        if ($fields === null) {
            return [[], ['kind' => 'Unknown item type.']];
        }
        if (!is_array($raw) || (array_is_list($raw) && $raw !== [])) {
            return [[], ['values' => 'Values are invalid.']];
        }
        $errors = [];
        $out = [];
        foreach (array_keys($raw) as $k) {
            if (!array_key_exists($k, $fields) && $k !== 'costCurrency') {
                $errors[$k] = 'Unknown field.';
            }
        }
        foreach ($fields as $key => [$type, $opt, $required]) {
            $v = $raw[$key] ?? null;
            $blank = $v === null || $v === '' || $v === [];
            if ($blank) {
                if ($required) {
                    $errors[$key] = 'Required.';
                }
                if ($type === 'bool') {
                    $out[$key] = false;
                }
                continue;
            }
            switch ($type) {
                case 'text':
                    if (!is_string($v) || mb_strlen($v) > $opt) {
                        $errors[$key] = "At most {$opt} characters.";
                    } else {
                        $out[$key] = Clean::text($v, $opt);
                    }
                    break;
                case 'select':
                    is_string($v) && in_array($v, $opt, true) ? $out[$key] = $v : $errors[$key] = 'Choose an option from the list.';
                    break;
                case 'date':
                    Clean::isDate($v) ? $out[$key] = $v : $errors[$key] = 'Enter a date.';
                    break;
                case 'datetime':
                    is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $v) ? $out[$key] = $v : $errors[$key] = 'Enter a date and time.';
                    break;
                case 'int':
                    is_int($v) && $v >= $opt[0] && $v <= $opt[1] ? $out[$key] = $v : $errors[$key] = 'Enter a whole number.';
                    break;
                case 'bool':
                    is_bool($v) ? $out[$key] = $v : $errors[$key] = 'Invalid.';
                    break;
                case 'money':
                    $cur = $raw['costCurrency'] ?? null;
                    if (!(is_int($v) || is_float($v)) || $v < 0 || $v > 10_000_000) {
                        $errors[$key] = 'Enter an amount.';
                    } elseif (!is_string($cur) || $cur === '' || strlen($cur) > 10) {
                        $errors['costCurrency'] = 'Choose a currency.';
                    } else {
                        $out[$key] = round((float) $v, 2);
                        $out['costCurrency'] = $cur;
                    }
                    break;
                case 'people':
                    $lines = is_array($v) && array_is_list($v) ? $v : null;
                    if ($lines === null || count($lines) > $opt || array_filter($lines, fn ($l) => !is_string($l) || $l === '' || mb_strlen($l) > 120)) {
                        $errors[$key] = "Up to {$opt} names, each under 120 characters.";
                    } else {
                        $out[$key] = array_map(fn ($l) => Clean::text($l, 120), $lines);
                    }
                    break;
                case 'passengers':
                    [$list, $err] = self::passengers($v, $opt);
                    $err ? $errors[$key] = $err : $out[$key] = $list;
                    break;
            }
        }
        if (isset($raw['costCurrency']) && !isset($raw['cost'])) {
            $errors['costCurrency'] = 'A currency needs a cost.';
        }
        foreach ([['arriveAt', 'departAt'], ['checkOut', 'checkIn'], ['dropOffDate', 'collectionDate']] as [$later, $earlier]) {
            if (isset($out[$later], $out[$earlier]) && $out[$later] < $out[$earlier]) {
                $errors[$later] = 'This is before the earlier date.';
            }
        }
        return [$out, $errors];
    }

    /** @return array{0: list<array<string, string>>, 1: ?string} */
    private static function passengers(mixed $v, int $max): array
    {
        if (!is_array($v) || !array_is_list($v) || count($v) > $max) {
            return [[], "At most {$max} people."];
        }
        $out = [];
        foreach ($v as $p) {
            if (!is_array($p)) {
                return [[], 'Invalid person.'];
            }
            $name = Clean::text(preg_replace('/\s+/', ' ', (string) ($p['name'] ?? '')), 120);
            if ($name === '') {
                continue;
            }
            $class = $p['travelClass'] ?? '';
            if (!in_array($class, self::TRAVEL_CLASSES, true)) {
                return [[], 'Choose a class for each person.'];
            }
            $row = ['name' => $name, 'travelClass' => $class];
            if (isset($p['uid']) && is_string($p['uid']) && preg_match('/^[A-Za-z0-9_-]{1,128}$/', $p['uid'])) {
                $row['uid'] = $p['uid'];
                $row['email'] = Clean::text($p['email'] ?? '', 254);
            }
            $out[] = $row;
        }
        return [$out, null];
    }
}
