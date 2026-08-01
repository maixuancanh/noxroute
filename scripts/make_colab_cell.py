#!/usr/bin/env python3
"""Create a ready-to-paste OmniVoice Google Colab cell for demo narration.

The script is intentionally local-only: it does not call Colab, upload files, or
touch external services. Paste the generated cell into the official OmniVoice
notebook and run it on a GPU runtime.
"""

from __future__ import annotations

import argparse
import json
import random
import textwrap
from pathlib import Path


VOICE_PROFILES = [
    "male, teenager, moderate pitch, american accent",
    "female, teenager, high pitch, american accent",
    "male, young adult, high pitch, british accent",
    "female, young adult, moderate pitch, british accent",
    "male, young adult, moderate pitch, canadian accent",
    "female, young adult, high pitch, australian accent",
    "male, young adult, moderate pitch, indian accent",
    "female, young adult, moderate pitch, american accent",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a Google Colab cell for OmniVoice narration."
    )
    parser.add_argument(
        "--mode",
        choices=("design", "auto", "clone"),
        default="design",
        help="Voice mode. Use design unless an authorized reference voice is available.",
    )
    parser.add_argument(
        "--text",
        required=True,
        type=Path,
        help="Path to the narration text file.",
    )
    parser.add_argument(
        "--output",
        default="noxroute-narration.wav",
        help="WAV filename Colab should write.",
    )
    parser.add_argument(
        "--save",
        type=Path,
        help="Optional path to write the generated Colab cell.",
    )
    parser.add_argument(
        "--instruct",
        help="Fixed OmniVoice voice design profile. Must match a supported profile.",
    )
    parser.add_argument(
        "--history",
        type=Path,
        default=Path("demo-video/.omnivoice-profile-history.json"),
        help="Profile rotation state for design mode.",
    )
    parser.add_argument(
        "--include-setup",
        action="store_true",
        help="Include pip install and model loading in the generated cell.",
    )
    return parser.parse_args()


def read_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        raise SystemExit(f"Narration text is empty: {path}")
    return text


def load_history(path: Path) -> list[str]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if item in VOICE_PROFILES]


def save_history(path: Path, history: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(history, indent=2) + "\n", encoding="utf-8")


def choose_profile(history_path: Path, fixed_profile: str | None) -> str:
    if fixed_profile:
        if fixed_profile not in VOICE_PROFILES:
            valid = "\n".join(f"- {profile}" for profile in VOICE_PROFILES)
            raise SystemExit(f"Unsupported voice profile:\n{fixed_profile}\n\nValid profiles:\n{valid}")
        return fixed_profile

    history = load_history(history_path)
    remaining = [profile for profile in VOICE_PROFILES if profile not in history]
    if not remaining:
        history = []
        remaining = VOICE_PROFILES[:]

    selected = random.SystemRandom().choice(remaining)
    save_history(history_path, history + [selected])
    return selected


def setup_block() -> str:
    return textwrap.dedent(
        """
        !pip install omnivoice

        from omnivoice import OmniVoice
        import soundfile as sf
        import torch
        from IPython.display import Audio, display

        model = OmniVoice.from_pretrained(
            "k2-fsa/OmniVoice",
            device_map="cuda:0",
            dtype=torch.float16,
            load_asr=True,
        )
        """
    ).strip()


def render_cell(mode: str, text: str, output: str, profile: str | None, include_setup: bool) -> str:
    blocks: list[str] = []
    if include_setup:
        blocks.append(setup_block())

    safe_text = repr(text)
    safe_output = repr(output)

    if mode == "design":
        assert profile is not None
        generation = f"""
        import soundfile as sf
        from IPython.display import Audio, display

        narration_text = {safe_text}
        selected_voice = {profile!r}

        audio = model.generate(
            text=narration_text,
            instruct=selected_voice,
        )

        sf.write({safe_output}, audio[0], 24000)
        print(f"Selected OmniVoice profile: {{selected_voice}}")
        print("Saved:", {safe_output})
        display(Audio(audio[0], rate=24000))
        """
    elif mode == "auto":
        generation = f"""
        import soundfile as sf
        from IPython.display import Audio, display

        narration_text = {safe_text}
        audio = model.generate(text=narration_text)

        sf.write({safe_output}, audio[0], 24000)
        print("Saved:", {safe_output})
        display(Audio(audio[0], rate=24000))
        """
    else:
        generation = f"""
        import soundfile as sf
        from google.colab import files
        from IPython.display import Audio, display

        print("Upload only reference audio you are authorized to use.")
        uploaded = files.upload()
        ref_audio_path = list(uploaded.keys())[0]

        narration_text = {safe_text}
        audio = model.generate(
            text=narration_text,
            ref_audio=ref_audio_path,
        )

        sf.write({safe_output}, audio[0], 24000)
        print("Saved:", {safe_output})
        display(Audio(audio[0], rate=24000))
        """

    blocks.append(textwrap.dedent(generation).strip())
    blocks.append(
        textwrap.dedent(
            """
            from google.colab import files
            files.download(%r)
            """ % output
        ).strip()
    )
    return "\n\n".join(blocks) + "\n"


def main() -> None:
    args = parse_args()
    text = read_text(args.text)
    profile = None
    if args.mode == "design":
        profile = choose_profile(args.history, args.instruct)

    cell = render_cell(args.mode, text, args.output, profile, args.include_setup)
    if args.save:
        args.save.parent.mkdir(parents=True, exist_ok=True)
        args.save.write_text(cell, encoding="utf-8")
    print(cell)


if __name__ == "__main__":
    main()
