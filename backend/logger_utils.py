from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult
from typing import Any, Dict, List, Optional

class TerminalLoggerHandler(BaseCallbackHandler):
    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> None:
        print("\n" + "="*50)
        print("🚀 [LLM PROMPT SENT]")
        print("="*50)
        for i, prompt in enumerate(prompts):
            print(prompt)
        print("="*50 + "\n")

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        print("\n" + "="*50)
        print("✨ [LLM RESPONSE RECEIVED]")
        print("="*50)
        
        # Print generations
        for i, generation in enumerate(response.generations):
            for gen in generation:
                print(gen.text)
        
        print("-" * 30)
        print("📊 [TOKEN USAGE]")
        
        # Attempt to extract usage metadata from LLMResult or Generations
        usage = {}
        if response.llm_output and "token_usage" in response.llm_output:
            usage = response.llm_output["token_usage"]
        elif response.llm_output and "usage" in response.llm_output:
            usage = response.llm_output["usage"]
        
        # Check modern usage_metadata in the first generation's message
        try:
            if hasattr(response.generations[0][0], "message"):
                msg = response.generations[0][0].message
                if hasattr(msg, "usage_metadata") and msg.usage_metadata:
                    usage = msg.usage_metadata
        except (IndexError, AttributeError):
            pass

        if usage:
            input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
            output_tokens = usage.get("completion_tokens") or usage.get("output_tokens") or 0
            total_tokens = usage.get("total_tokens") or (input_tokens + output_tokens)
            
            print(f"Input Tokens:  {input_tokens}")
            print(f"Output Tokens: {output_tokens}")
            print(f"Total Tokens:  {total_tokens}")
        else:
            print("Token usage not provided by this model/provider.")
            
        print("="*50 + "\n")
