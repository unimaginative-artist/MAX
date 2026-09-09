#!/usr/bin/env python3
"""
=============================================================================
MAX Fine-Tuning Engine — Unsloth QLoRA / DPO Training Pipeline
=============================================================================
Fine-tunes a Qwen2.5-Coder base model on MAX's collected self-model memories,
agentic problem-solving steps, and DPO preference pairs.
Directly exports 4-bit quantized GGUF weights for Ollama / llama.cpp execution.

Usage:
  python scripts/finetune_unsloth.py --model 1.5B --format dpo
  python scripts/finetune_unsloth.py --model 7B --format sharegpt --export_gguf
=============================================================================
"""

import os
import sys
import json
import argparse
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

def parse_args():
    parser = argparse.ArgumentParser(description="Fine-tune MAX with Unsloth QLoRA")
    parser.add_argument("--model", type=str, default="1.5B", choices=["1.5B", "7B"],
                        help="Qwen2.5-Coder model size (1.5B for local 4GB VRAM / 7B for cloud)")
    parser.add_argument("--format", type=str, default="dpo", choices=["dpo", "sharegpt", "alpaca"],
                        help="Training data format to use from .max/dataset/")
    parser.add_argument("--max_seq_length", type=int, default=4096,
                        help="Maximum sequence token length")
    parser.add_argument("--epochs", type=int, default=3,
                        help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=2,
                        help="Per-device training batch size")
    parser.add_argument("--learning_rate", type=float, default=2e-4,
                        help="Learning rate for AdamW")
    parser.add_argument("--export_gguf", action="store_true", default=True,
                        help="Automatically export 4-bit GGUF (q4_k_m) on completion")
    parser.add_argument("--output_dir", type=str, default="dist/max_model_gguf",
                        help="Output directory for merged weights / GGUF")
    return parser.parse_args()

def main():
    args = parse_args()
    print("=" * 60)
    print("         MAX UNLOTH QLoRA / DPO TRAINING ENGINE             ")
    print(f"  Model: Qwen2.5-Coder-{args.model}-Instruct")
    print(f"  Format: {args.format}")
    print(f"  Max Context: {args.max_seq_length} tokens")
    print("=" * 60)

    dataset_dir = Path(os.getcwd()) / ".max" / "dataset"
    if args.format == "dpo":
        dataset_file = dataset_dir / "compiled_dpo.json"
    elif args.format == "sharegpt":
        dataset_file = dataset_dir / "compiled_sharegpt.json"
    else:
        dataset_file = dataset_dir / "compiled_alpaca.json"

    if not dataset_file.exists():
        print(f"❌ Error: Dataset file not found at {dataset_file}")
        print("Run `node tools/compile_dataset.mjs` first to generate dataset files.")
        sys.exit(1)

    print(f"✅ Found dataset: {dataset_file} ({dataset_file.stat().st_size / 1024:.1f} KB)")

    try:
        from unsloth import FastLanguageModel
        from unsloth import is_bfloat16_supported
        import torch
        from datasets import load_dataset
        from trl import SFTTrainer, DPOTrainer
        from transformers import TrainingArguments
    except ImportError:
        print("\n⚠️  Unsloth dependencies not installed in current Python environment.")
        print("To run training on a GPU instance (Colab, RunPod, or local Linux GPU):")
        print("  pip install \"unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git\"")
        print("  pip install --no-deps trl peft loralib sentencepiece bitsandbytes transformers datasets")
        print(f"\nConfiguration verified: Ready for execution with {dataset_file}.")
        return

    model_name = f"unsloth/Qwen2.5-Coder-{args.model}-Instruct-bnb-4bit"
    print(f"⬇️  Loading 4-bit base model: {model_name}...")

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_name,
        max_seq_length=args.max_seq_length,
        dtype=None, # Auto detect Float16 / Bfloat16
        load_in_4bit=True,
    )

    print("🔧 Applying LoRA target adapters (r=16, alpha=16)...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_alpha=16,
        lora_dropout=0, # Unsloth optimized: 0 dropout
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
        max_seq_length=args.max_seq_length,
    )

    print(f"📖 Loading and formatting dataset ({args.format})...")
    with open(dataset_file, "r", encoding="utf-8") as f:
        raw_data = json.load(f)
    print(f"Loaded {len(raw_data)} training samples.")

    training_args = TrainingArguments(
        output_dir="runs/max_checkpoint",
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        warmup_steps=10,
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        fp16=not is_bfloat16_supported(),
        bf16=is_bfloat16_supported(),
        logging_steps=5,
        optim="adamw_8bit",
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        seed=3407,
    )

    if args.format == "dpo":
        print("🚀 Starting Direct Preference Optimization (DPO)...")
        from datasets import Dataset
        dpo_dataset = Dataset.from_list(raw_data)
        trainer = DPOTrainer(
            model=model,
            ref_model=None, # Unsloth PEFT handles reference internally
            args=training_args,
            beta=0.1,
            train_dataset=dpo_dataset,
            tokenizer=tokenizer,
            max_length=args.max_seq_length,
            max_prompt_length=args.max_seq_length // 2,
        )
    else:
        print("🚀 Starting Supervised Fine-Tuning (SFT)...")
        from datasets import Dataset
        sft_dataset = Dataset.from_list(raw_data)
        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=sft_dataset,
            dataset_text_field="text" if "text" in raw_data[0] else "instruction",
            max_seq_length=args.max_seq_length,
            dataset_num_proc=2,
            packing=False,
            args=training_args,
        )

    trainer.train()
    print("🎉 Training completed successfully!")

    if args.export_gguf:
        print(f"📦 Exporting 4-bit quantized GGUF (q4_k_m) to {args.output_dir}...")
        model.save_pretrained_gguf(
            args.output_dir,
            tokenizer,
            quantization_method="q4_k_m"
        )
        modelfile_path = Path(args.output_dir) / "Modelfile"
        with open(modelfile_path, "w", encoding="utf-8") as f:
            f.write("""FROM ./unsloth.Q4_K_M.gguf

PARAMETER stop "<|im_start|>"
PARAMETER stop "<|im_end|>"
PARAMETER temperature 0.2
PARAMETER top_p 0.9

SYSTEM \"\"\"You are MAX, a sovereign AI engineering assistant. Keep your responses concise, conversational, and direct. Output spoken words only.\"\"\"
""")
        print(f"✅ GGUF and Ollama Modelfile created in {args.output_dir}")
        print("To load into Ollama: ollama create max-coder:finetuned -f dist/max_model_gguf/Modelfile")

if __name__ == "__main__":
    main()
