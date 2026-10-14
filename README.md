# GUVI Direct API Auto-Solver Extension (v3.0)

Built directly from GUVI's internal `course_content.js`, `steroid.js`, and `learnable.js`.

## Why v3.0 Works 100% Reliably
1. **Direct Video Completion (`type: 'video-activity'`)**: Calls `authorize.invisibleAjax({ type: 'video-activity', courseId, sublessonId, level }, 'courseContent')` directly (the exact API inside `course_content.js` lines 371-380) to immediately mark the video as watched and unlock the Activity quiz without waiting for the timer.
2. **Direct Quiz Validation (`type: 'validate-quiz'`)**: Instead of fighting Bootstrap radio buttons, v3.0 populates `$('.quizstorage').data()` directly (where `course_content.js` line 1255 reads answers from) and calls `authorize.invisibleAjax({ type: 'validate-quiz', courseId, sublessonId, quizData }, 'courseContent')`.
3. **1-Second Answer Discovery (`data.result`)**: GUVI's `validate-quiz` response returns `data.result` (e.g. `["1", "0"]`), where `"1"` means Correct and `"0"` means Wrong (`course_content.js` lines 1265-1285). v3.0 locks in every `"1"` and increments only the `"0"` questions, solving any multi-question quiz in 1-3 seconds.
4. **Native Auto-Advance (`CourseContent.renderCourse(data)`)**: When all quiz answers are correct, GUVI's `validate-quiz` response returns the next lesson object and updated syllabus array (`data[0].validated`). v3.0 passes that directly to `new CourseContent().renderCourse(data)` and auto-dismisses the Geekoins popup modal (`#preassessmentCompletionModal`).
