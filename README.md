# GUVI Auto-Watcher & Quiz Helper Extension (v2.0)

## What Was Fixed in v2.0 (Based on Your GUVI Page HTML)
1. **Exact Option Selection (`#video-activity`)**: GUVI hides `<input type="radio">` inside `<button class="btn options">` inside `<div class="option-buttons" data-toggle="buttons">`. v2.0 clicks `.btn.options`, sets `.active`, sets `input.checked = true`, and triggers jQuery's `$(radio).prop('checked', true).trigger('change')` in the `MAIN` world so GUVI always registers the selection.
2. **Multi-Question Card Navigation (`#q1VideoActivity` -> `#q2VideoActivity`)**: GUVI puts each question on a separate card where only the last card has `#submitbutton` and earlier cards have `.nextbutton` (`Next`). v2.0 steps through Question 1 -> clicks `Next` -> Question 2 -> clicks `Submit` (`#submitbutton`).
3. **Smart Per-Question Lock-In (`#quesring1.has-success`)**: After each submission, v2.0 checks `#quesring1`, `#quesring2`, etc. Any question that gets `.has-success` is locked in, and only remaining wrong questions cycle to the next option.
4. **Plyr `00:00` Reset Fix**: When a video finishes on GUVI, Plyr resets the timer to `00:00` (`video.ended === false`) and unlocks `.quiz-lock.hide`. v2.0 detects `.quiz-lock.hide` so it immediately solves the quiz instead of replaying the video.
5. **Exact Sidebar Auto-Next (`#courseTocAccordion ul.stepper`)**: Detects the active lesson via `a.text-purple` and clicks the next `<li class="sublesson">` and its `<a>` tag (expanding `#modulel2`, `#modulel3`, etc. automatically).
