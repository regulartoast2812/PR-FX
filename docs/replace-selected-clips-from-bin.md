# Replace Selected Clips from Bin

`Replace Selected Clips from Bin` swaps the media under selected Timeline clips with the selected Project/Bin item while preserving the edit the user already built.

This is a major PR FX feature because Premiere's public scripting API does not provide a single safe "replace clip but keep everything" command. PR FX has to treat replace as a transactional operation: capture the existing clip state, perform the swap, verify the important details, and roll everything back if Premiere refuses part of the change.

## User behavior

1. Select one or more clips on the Timeline.
2. Select the replacement item in the Project panel/bin.
3. Run `Replace Selected Clips from Bin`.

For each selected Timeline clip, PR FX should preserve:

- timeline track
- timeline start/end
- selected source in/out range
- speed and reverse-speed state
- linked audio/video pairing when replacing linked media
- clip-level effects
- clip attributes such as scale, position, opacity, crop, audio gain, and keyframes
- transitions connected to the replaced clip, when the transition can be safely restored

If a selected Timeline clip is audio-only, PR FX may replace it with the audio stream of a video item or with an audio-only item. If a selected Timeline clip is video, PR FX must not replace it with an audio-only item.

## Source range is not optional

The most important invariant: a replaced clip must keep both source In and source Out.

If only source In is restored, the clip can look correct immediately after replace, but Premiere may later reinterpret the clip when the project is reopened or when speed changes are applied. That creates the nasty failure mode where audio starts from the beginning of the source after restart, or the clip can no longer be speed-changed cleanly.

Replacement therefore must:

1. capture the original Timeline clip's `inPoint` and `outPoint` before replacing;
2. apply the same source range to the replacement;
3. read the replacement back from the sequence;
4. verify both source In and source Out;
5. roll back the whole replace if either value does not stick.

## Replace routes

PR FX has two replace routes.

### Direct source swap

The preferred path is direct media swap:

```js
trackItem.projectItem = replacementProjectItem
```

or, if needed, QE `replaceWith`.

This keeps the existing Timeline clip alive, so it is the least lossy path for effects, keyframes, speed, timing, and links. It still must restore and verify the original source In/Out after the swap because Premiere can reset the new media to its own source start.

Direct swap must never be allowed to half-succeed. If the video swaps but linked audio does not, or if source In/Out cannot be restored, the command must fail and roll back.

### Rebuild/staging fallback

If direct swap fails, PR FX stages the replacement on temporary staging tracks, retimes/trims it to match the original Timeline clip, copies state across, lifts the old clip, moves the staged clip into the original gap, and restores transitions.

For durable source timing, the replacement Project item is temporarily set to the original source In/Out before it is staged. The bin item is shared state, so PR FX restores the bin item's previous In/Out immediately after staging.

This matters especially for audio: setting source In/Out only after the Timeline clip exists can display correctly during the current session but serialize incorrectly after save/reopen.

## Failure policy

Replace should prefer refusing over corrupting.

Rollback should happen when:

- no compatible replacement item is selected;
- the replacement media category is invalid;
- linked video/audio would point to different source files;
- Premiere refuses source In or source Out;
- the replacement cannot cover the original duration at the original speed;
- the replaced clip cannot be re-read from the Timeline after mutation;
- copied properties/keyframes clearly do not match the original.

The command should report the failure reason in the CEP panel and leave the Timeline as it was before the attempt.

## Regression checklist

Before shipping changes to replace logic, test at least:

- video clip starting at source frame 0;
- video clip with non-zero source In;
- audio-only clip with non-zero source In;
- linked video/audio clip;
- clip with speed changed before replace;
- replaced clip speed-changed after replace;
- save, close project, reopen, and confirm replaced audio still uses the correct source timing;
- clip with an effect/keyframe before replace;
- clip with an In or Out transition before replace.

The important reopen test is:

1. replace an audio clip whose source In is not zero;
2. save the project;
3. close and reopen Premiere/project;
4. confirm the Timeline clip still plays from the same source moment, not from source start.
