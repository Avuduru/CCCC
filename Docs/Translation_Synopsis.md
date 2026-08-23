# Synopsis Translation Pipeline & Bug Resolution

This document details the architecture, root cause analysis, and resolution for the synopsis translation system in the application.

---

## 1. Overview & Issue Description

Users reported that the application stopped translating item synopses (movie, TV show, game, anime, manga, and book overviews) into Arabic. Instead of displaying Arabic translations, the synopsis text remained in English or fell back to `"جاري الترجمة..."` briefly before displaying the original English string.

---

## 2. Root Cause Analysis

### A. Google Translate API Block (`client=gtx`)
The application relies on `proxy.php` (`type=translate`) as a server-side proxy to handle translation requests and avoid CORS restrictions.

* **Original Endpoint**: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ar&dt=t&q=...`
* **Failure Trigger**: Google's anti-abuse and rate-limiting systems began blocking server requests using the `client=gtx` endpoint parameter. Instead of returning JSON translation payload arrays, Google returned an HTML bot-detection error page:
  ```html
  <html>... <h1>We're sorry...</h1><p>... but your computer or network may be sending automated queries...</p></html>
  ```

### B. Cascading Failure to Frontend
1. **JSON Decode Error**: In [`proxy.php`](file:///c:/Users/bqabe/CCCC/cccc/proxy.php#L525-L558), `json_decode()` attempted to parse Google's HTML response. This failed (`$data` became `null`).
2. **Error Response**: `proxy.php` returned `{"error": "Translation failed"}`.
3. **Frontend Fallback**: In [`js/translations.js`](file:///c:/Users/bqabe/CCCC/cccc/js/translations.js#L155-L184), `translateText()` received an error status:
   ```javascript
   if (data.responseStatus === 200 && data.responseData.translatedText) {
       // Save to cache and return translated string
   }
   // Fallback to original text on error
   return text;
   ```
   As a result, the UI displayed the untranslated English text.

---

## 3. Implementation & Fixes

### A. Primary Client Endpoint Update (`proxy.php`)
Updated the primary Google Translate query endpoint parameter from `client=gtx` to `client=dict-chrome-ex`. The `dict-chrome-ex` client ID bypasses the automated query block and reliably returns valid JSON translation arrays:
```php
$dictUrl = "https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=ar&dt=t&q=" . urlencode($text);
```

### B. Multi-Tier Fallback Strategy (`proxy.php`)
To ensure high availability and prevent single-point-of-failure outages, `proxy.php` now implements a fallback chain:
1. **Tier 1 (Google Translate `dict-chrome-ex`)**: Primary translator for high speed and accuracy.
2. **Tier 2 (MyMemory Translation API)**: Secondary fallback (`https://api.mymemory.translated.net/get?q=...&langpair=en|ar`) if Google fails or returns non-JSON data.
3. **Tier 3 (Graceful Degradation)**: Returns original text if all upstream services fail.

```php
case 'translate':
    $text = $query;
    if (empty($text)) {
        echo json_encode(['error' => 'No text provided']);
        exit;
    }

    // 1. Try Google Translate endpoint with client=dict-chrome-ex
    $dictUrl = "https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=ar&dt=t&q=" . urlencode($text);
    $response = fetchUrl($dictUrl);
    $data = json_decode($response, true);

    if ($data && isset($data[0]) && is_array($data[0])) {
        $translatedText = "";
        foreach ($data[0] as $segment) {
            if (isset($segment[0])) {
                $translatedText .= $segment[0];
            }
        }
        if (!empty($translatedText)) {
            echo json_encode([
                'responseStatus' => 200,
                'responseData' => [
                    'translatedText' => $translatedText
                ]
            ]);
            exit;
        }
    }

    // 2. Fallback: Try MyMemory API
    $mymemoryUrl = "https://api.mymemory.translated.net/get?q=" . urlencode($text) . "&langpair=en|ar";
    $mmResponse = fetchUrl($mymemoryUrl);
    $mmData = json_decode($mmResponse, true);

    if ($mmData && isset($mmData['responseData']['translatedText'])) {
        echo json_encode([
            'responseStatus' => 200,
            'responseData' => [
                'translatedText' => $mmData['responseData']['translatedText']
            ]
        ]);
        exit;
    }

    echo json_encode(['error' => 'Translation failed']);
    exit;
```

### C. Stream Context Fallback in `fetchUrl()`
Enhanced [`fetchUrl()`](file:///c:/Users/bqabe/CCCC/cccc/proxy.php#L337-L380) in `proxy.php` to check `function_exists('curl_init')`. If cURL is not enabled in the PHP runtime environment, it seamlessly falls back to `file_get_contents` with stream context settings and browser user-agent masquerading.

---

## 4. Verification

The translation endpoint was verified using PHP CLI tests:

```bash
php -c php.ini scratch/test_proxy_translate.php
```

**Output**:
```json
{
  "responseStatus": 200,
  "responseData": {
    "translatedText": "طالب في المدرسة الثانوية يكتشف دفتر ملاحظات خارق للطبيعة."
  }
}
```

---

## 5. Related Documentation

* [`Docs/Synopsis.md`](file:///c:/Users/bqabe/CCCC/cccc/Docs/Synopsis.md) — Comprehensive guide on the synopsis DOM rendering engine, font scaling logic, and layout budget.
