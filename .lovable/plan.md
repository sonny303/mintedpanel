# Plan - Harming /tasks/$id Route Against Malformed SOP Content

Ensure that the task details page and completion service safely handle any scenario where `sop_content` in the database is not an array (e.g. `null`, `string`, empty object, or missing) without crashing the route or throwing runtime exceptions.

## User Review Required

> [!IMPORTANT]
> - There are no schema modifications.
> - An inline amber alert notice is displayed when `sop_content` is malformed (not an array).

## Technical Details

### 1. Update `src/services/tasks.ts`
Modify `completeSOPStep` to safely treat `existing.sopContent` as an empty list if it's not a valid array, avoiding runtime type errors on operations like `.find` or `.map`:
- Check if `Array.isArray(existing.sopContent)` is true. If not, use an empty array `[]` for step operations.

### 2. Update `src/routes/tasks.$id.tsx`
Guard the `sopContent` array operations inside the component rendering:
- Check if `Array.isArray(task?.sopContent)` is true.
- Compute the sorted `steps` safely. If `sopContent` is not an array, default to `[]`.
- If `sopContent` is not an array, render an inline amber alert block styled nicely:
  ```tsx
  <div className="p-6 text-[14px] text-amber-800 bg-amber-50/50">
    SOP steps could not be read for this task.
  </div>
  ```
