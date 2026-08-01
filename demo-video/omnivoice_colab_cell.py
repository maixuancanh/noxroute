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

import soundfile as sf
from IPython.display import Audio, display

narration_text = 'NoxRoute is a private strategy router for public Uniswap markets.\n\nOn a normal DEX, the wallet, token transfers, direction, size, limits, cadence, and remaining budget are all visible. That turns a recurring swap strategy into a target.\n\nNoxRoute changes the boundary. The user encrypts the strategy first: budget, clip size, limit price, slippage, and direction become Nox handles before strategy calldata is submitted.\n\nNox then does the load-bearing work. It keeps persistent private state across epochs, checks encrypted eligibility and balances, nets opposing private flow, and allocates the result back to owners.\n\nOnly the aggregate residual is revealed for settlement. If WETH and USDC flow cancel each other internally, that matched volume never needs to hit the public market. If anything remains, the residual goes through the official Uniswap V3 SwapRouter and pool on Sepolia.\n\nThe contracts do not modify Uniswap. Nox protects the strategy; Ethereum records the lifecycle; Uniswap settles only what remains.\n\nThe demo shows the full path: connect a wallet, deposit test WETH, create an encrypted strategy, lock an epoch, wait for the Nox aggregate proof, settle the residual, and reveal only owner-authorized private balances.\n\nThe important claim is narrow and verifiable. Deposits, wallets, timing, and contract calls are public. Direction, remaining budget, requested volume, matched volume, per-user allocation, and private balances stay behind Nox access control until the viewer is authorized.\n\nThat is why Nox belongs inside the swap flow. It is not just hiding a form field. It changes what the public chain needs to learn.'
selected_voice = 'male, teenager, moderate pitch, american accent'

audio = model.generate(
    text=narration_text,
    instruct=selected_voice,
)

sf.write('noxroute-narration.wav', audio[0], 24000)
print(f"Selected OmniVoice profile: {selected_voice}")
print("Saved:", 'noxroute-narration.wav')
display(Audio(audio[0], rate=24000))

from google.colab import files
files.download('noxroute-narration.wav')
