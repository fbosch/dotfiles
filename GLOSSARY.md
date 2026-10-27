# Dotfiles

Language for the configured tools and agent workflows in this repository.

## Language

**Skill visibility**:
The policy distinguishing skills advertised in the agent's prompt from skills available for discovery or advisory recommendations. Visibility does not mean a skill's instructions have been loaded.
_Avoid_: Skill loading

**Execution reservation**:
A capacity slot a worker holds while its child session may still be executing. It is released only once the child is known to have stopped, so a worker in cleanup uncertainty keeps its reservation.
_Avoid_: Slot, lease

**Evidence archive**:
Conversation text, tool output, and images preserved outside active context, together with the information needed to identify and recover them.
_Avoid_: Masking store, compaction store
