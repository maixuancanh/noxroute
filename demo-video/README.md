# NoxRoute Demo Voice

This folder contains the narration source and Colab helper for generating a WAV voiceover with the official k2-fsa OmniVoice Google Colab.

Official notebook:

```text
https://colab.research.google.com/github/k2-fsa/OmniVoice/blob/master/docs/OmniVoice.ipynb
```

## Generate the Colab Cell

From the project root:

```powershell
python scripts/make_colab_cell.py --mode design --text demo-video/narration.txt --output noxroute-narration.wav --save demo-video/omnivoice_colab_cell.py --include-setup
```

Then open the official notebook, confirm the title is `OmniVoice.ipynb - Colab`, connect a GPU runtime, paste the generated cell, run it, and download `noxroute-narration.wav`.

## Voice Mode

The default `design` mode uses randomized youthful voice design and rotates through the supported OmniVoice profiles without repeating until the pool is exhausted.

Do not use `clone` mode unless the reference voice is authorized for cloning and uploading to Google Colab.

## Output

Place the downloaded WAV here:

```text
demo-video/noxroute-narration.wav
```
