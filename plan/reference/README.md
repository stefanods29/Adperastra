# Planner reference (not for the coding agent)

The coding agent never reads this folder: it builds only from `plan/steps/` (AGENTS.md).

`v1-steps/` holds the step texts of the first plan (v1), unchanged. They describe what each feature must do. Plan v2 split them into smaller steps with new numbers, so a v1 file name does **not** match the v2 step with the same name (v1 `step-06c.md` is v2 06d and 06e, for example). `plan/roadmap.md`, section "Where the v1 plan's features went", maps every v1 feature to its v2 step.

The planner uses these texts when writing a guide (`plan/EXPANDING.md`): every feature that the roadmap gives to the step must be in the guide, unless the guide's "Do not do" section names the later step that takes it.
