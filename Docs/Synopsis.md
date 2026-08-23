# Synopsis Engine & Text Budget Architecture

This document maps out the end-to-end lifecycle of the Synopsis (Description) text box. It traces how data is fetched from third-party APIs, how it is translated asynchronously, and dissects a critical data-loss bug that occurs when users attempt to manually edit the text.

---

## 1. Where the Data Comes From

When a user searches for a title, `js/ui.js` (`selectItem()`) routes the request to different APIs based on the active category. The synopsis data is extracted from the respective JSON payloads:

*   **Movies & TV (TMDB)**: Extracted from `item.overview`.
*   **Games (RAWG)**: Fetched in a secondary parallel request to `proxy.php?type=game_details`, extracting the `description_raw` or falling back to stripped HTML `description`.
*   **Anime & Manga (Jikan)**: Extracted from `item.synopsis`.
*   **Books (Open Library)**: Extracted from `item.first_sentence`, or falls back to `item.volumeInfo.description`.

---

## 2. The Translation Pipeline (`js/translations.js`)

Because the source APIs return descriptions in English (or Romaji), the application implements an asynchronous, proxy-based translation engine. For full details on the proxy endpoints, Google Translate client update, and MyMemory fallback architecture, see [`Docs/Translation_Synopsis.md`](file:///c:/Users/bqabe/CCCC/cccc/Docs/Translation_Synopsis.md).

1.  **Immediate Fallback**: The app instantly populates the UI with a temporary string: `"جاري الترجمة..."` (Translating...).
2.  **The API Call**: The English text is passed to `translateText(text)`. This function sends a request to `proxy.php?type=translate&query=...`, which routes to Google Translate (`dict-chrome-ex`) with a fallback to MyMemory API.
3.  **Local Caching**: To save bandwidth and speed up repeated searches, the result is cached in the browser's `localStorage` using the first 50 characters of the string as a unique key (`trans_...`).
4.  **UI Update**: Once the Arabic translation resolves, it overwrites `state.meta.synopsis` and triggers `updateDisplayedInfo()` to inject the final Arabic text into the DOM.

---

## 3. The Text Budget Discrepancy (The Truncation Bug)

There is a severe architectural mismatch between how the CSS displays the text and how the JavaScript edits the text. This is the root cause of the destructive data-loss bug.

### A. The CSS Visual Capacities
The stylesheet (`style.v3.css`) defines layout-specific capacities for the synopsis container using `-webkit-line-clamp`:
*   **Horizontal Layout**: Capable of displaying up to **8 lines**.
*   **Vertical Layout**: Capable of displaying up to **24 lines**.

### B. The API Population Slicer
When `js/ui.js` (`updateDisplayedInfo`) inserts the text into the DOM, it forcefully slices the translated string to **8 lines** maximum:
```javascript
// Line 986 in js/ui.js
const clippedSynopsis = (state.meta.synopsis || '').split('\n').slice(0, 8).join('\n');
els.synopsisText().innerText = clippedSynopsis;
```

### C. The Destructive Input Listener
When the user clicks the synopsis text box to manually edit it, an `input` event listener fires in `js/app.js` (around line 210). 
**This listener contains hardcoded constraints that completely ignore the active orientation:**
```javascript
el.synopsisText.addEventListener('input', (e) => {
    let text = e.target.innerText;

    // Hard limit: 350 characters
    if (text.length > 350) {
        text = text.substring(0, 350);
        e.target.innerText = text;
    }

    // Hard limit: 4 lines
    const lines = text.split('\n');
    if (lines.length > 4) {
        e.target.innerText = lines.slice(0, 4).join('\n');
        // ... re-collapse cursor
    }
    state.meta.synopsis = e.target.innerText;
});
```

### The Bug Scenario in Action:
1.  The user searches for a game.
2.  The API fetches the description, translates it, and the `js/ui.js` slicer puts **8 lines** of Arabic text into the container.
3.  The user is currently in **Vertical** layout (which easily fits 24 lines). The 8 lines look perfect.
4.  The user notices a typo in the translation and presses `Backspace` to fix one letter.
5.  **The Catastrophe**: The `input` event listener fires. It evaluates the text, sees that it is 8 lines long, and instantly applies `lines.slice(0, 4)`. 
6.  **Result**: Without warning, lines 5, 6, 7, and 8 of the synopsis are instantly deleted from the screen.

---

## 4. How to Make it Better (The Fix)

The application already has a robust, dynamic text-sizing engine (`fitSynopsisToContainer`) and strict CSS boundaries (`-webkit-line-clamp`). Therefore, **arbitrarily destroying the user's string data in JavaScript is completely unnecessary and actively harmful.**

To solve this destructive fragmentation, we must remove the arbitrary text-budget limits across the board:

1.  **Abolish the Input Limits (`js/app.js`)**:
    We must completely delete the `substring(0, 350)` and `lines.slice(0, 4)` logic inside the `synopsisText` input listener. The user should be able to type or delete whatever they want. If they type too much, the font shrinks. If it still overflows, the CSS clamp visually hides it. But the underlying text data must *never* be forcefully deleted by the system.
    ```javascript
    // The New, Clean Listener:
    el.synopsisText.addEventListener('input', (e) => {
        state.meta.synopsis = e.target.innerText;
        // No destructive slicing!
    });
    ```
2.  **Abolish the API Population Slicer (`js/ui.js`)**:
    We must remove the hardcoded `.slice(0, 8)` in `updateDisplayedInfo`. When an API fetches a beautiful 20-line description, we should inject the full 20 lines into the UI and let the layout engine (CSS + JS scaling) handle the presentation, rather than pre-emptively destroying half the data.
