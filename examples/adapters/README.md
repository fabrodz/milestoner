# Environment adapters

The environment adapter is the one piece milestoner cannot supply for you. Unsticking a host is
host-shaped: a window that lost focus, a modal waiting for a click, a tool server that wedged, a
device that dropped off the bus. The engine only knows how to run a command line and read its exit
code.

`milestoner attend` runs whatever `environment.attendCommand` names, and playbook rule 3 is the only
thing that fires it. A headless project leaves it `null` and the rule cannot fire at all.

| Script | Platform | What it does |
| --- | --- | --- |
| `attend.sh` | macOS, Linux | Keeps a named application focused for the requested seconds. On macOS it also dismisses a modal button, where Accessibility permission has been granted. |
| `attend.ps1` | Windows | A focus keeper plus Win32 modal dismissal for any process with a main window. Born as the Unity adapter the overnight runs this engine came from actually used, hence its defaults. |

Copy one into your project, point `attendCommand` at it, and edit it until it matches your
environment:

```json
"environment": {
  "attendCommand": "bash .milestoner/adapters/attend.sh {{seconds}} Unity",
  "attendSeconds": 120
}
```

## The contract

Whatever the language, an adapter has four obligations. Both scripts here follow them.

1. **Take the seconds to spend** as `{{seconds}}`, and return within roughly that time.
2. **Print one line per thing it did.** The last ten lines are shown; the last one lands in
   `.milestoner/supervisor-log.md`, so make it a summary.
3. **Exit `0` when it did its job, non-zero when it could not.** That is how the supervisor tells
   "nudged the environment" from "the environment is not there" - and the second one is worth
   escalating, not retrying.
4. **Be idempotent and safe to run mid-session.** It can fire while the agent is working, so it must
   never touch project files, never kill the agent, and never restart anything the session holds.
