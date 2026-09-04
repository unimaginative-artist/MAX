# 🧠 MAX-LLM Fine-Tuning Cookbook (v1.0)
*A developer recipe to compile MAX's memories, fine-tune a custom local model (QLoRA), and export to GGUF format.*

This document provides a step-by-step pipeline to extract, compile, and clean historical conversation logs from MAX and SOMA, then train a local model like `Qwen2.5-Coder-7B-Instruct` or `Llama-3-8B-Instruct` to create a proprietary, custom-embodied local model optimized specifically for agentic execution.

---

## 📂 Phase 1: Compile the Dataset

We have built a dedicated dataset compiler `tools/compile_dataset.mjs` that aggregates and cleans your agent's experiences.

### 1. Run the Compiler
Execute the compiler from the project root:
```bash
node tools/compile_dataset.mjs
```

### 2. Output Data Formats
The compiler outputs two deduplicated training files into `.max/dataset/`:
*   `compiled_sharegpt.json` (ShareGPT format) — recommended for multi-turn dialogue tuning.
*   `compiled_alpaca.json` (Alpaca format) — recommended for single-turn instruction tuning.

---

## 🛠️ Phase 2: Set Up Training Environment

For fast, memory-efficient fine-tuning on consumer-grade GPUs, we use **Unsloth** (up to 2x faster, uses 70% less VRAM).

### 1. Launch a GPU Instance
Start a notebook or script on a GPU provider (Google Colab, RunPod, or Kaggle) equipped with at least 16GB VRAM (e.g., NVIDIA T4, L4, or A10G).

### 2. Install Dependencies
Run the following package installations:
```bash
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft loralib sentencepiece bitsandbytes transformers datasets
```

---

## 🚀 Phase 3: Run the Fine-Tuning Script

Upload your compiled `compiled_sharegpt.json` dataset and the Python training script `scratch/finetune_unsloth.py` to your GPU instance.

### 1. Fine-Tuning Configuration
The `finetune_unsloth.py` script automatically configures:
*   **Base Model**: `Qwen/Qwen2.5-Coder-7B-Instruct`
*   **QLoRA (4-bit)**: Compresses the base model to save GPU memory.
*   **Rank (r=16, alpha=16)**: Fine-tunes attention queries and projection matrices.
*   **Prompt Formatting**: Formats conversations to Qwen2.5's chat template.
*   **Merging & GGUF Export**: Merges PEFT adapters and exports directly to 4-bit quantized GGUF (`q4_k_m`).

### 2. Run Training
Execute the training process:
```bash
python finetune_unsloth.py
```

---

## 👾 Phase 4: Import and Run Local MAX-LLM

Once training finishes, download the output folder `max_llm_gguf/` to your local machine.

### 1. Create the Ollama Model File
Create a file named `Modelfile` inside the model folder:
```dockerfile
FROM ./unsloth.Q4_K_M.gguf

# Set prompt parameters
PARAMETER stop "<|im_start|>"
PARAMETER stop "<|im_end|>"

# Set the agent persona system prompt instructions
SYSTEM """You are MAX, a sovereign AI engineering assistant. Keep your responses concise, conversational, and direct. Output spoken words only."""
```

### 2. Register the Model in Ollama
Run this command in your terminal to build the model:
```bash
ollama create max-llm -f Modelfile
```

### 3. Update MAX Configuration
Update your `.env` or `config/api-keys.env` to load your newly minted local model:
```env
MAX_LOCAL_MODEL=max-llm
```
Restart your launcher to load MAX on its own proprietary local brain!
