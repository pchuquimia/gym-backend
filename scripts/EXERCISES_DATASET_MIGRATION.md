# Exercises dataset migration

The active external catalog is pinned to commit
`7455efae41b330c265e7cd4b78dfa848e7ce5ebd`.

## Preview metadata

```powershell
node scripts/importExercisesDataset.js --dry-run
```

## Import and activate the external catalog

```powershell
node scripts/importExercisesDataset.js --apply --switch
```

This imports or updates the external exercises, saves the active state of the
previous system catalog, and hides that previous catalog. Custom exercises,
routines, and training history are not modified.

## Upload missing media

```powershell
node scripts/uploadDatasetMediaToCloudinary.js
node scripts/uploadDatasetMediaToCloudinary.js --apply --concurrency=8
```

The command is resumable. By default it only processes exercises missing a
thumbnail or animation. Use `--force` only when all Cloudinary assets must be
overwritten.

## Restore the previous catalog

Preview the stored switch:

```powershell
node scripts/importExercisesDataset.js --restore-previous
```

Restore it:

```powershell
node scripts/importExercisesDataset.js --restore-previous --apply
```

Restoring reactivates each previous system exercise according to its saved
state and hides the external dataset. It does not delete imported records or
Cloudinary assets.
