"""
Model Factory - Instantiate LLM based on user preference

Maps frontend model IDs to actual LLM instances (OpenAI or Anthropic).
Used throughout the LLM pipeline to enable dynamic model selection.

Includes automatic fallback logic when one provider is unavailable.
"""

import logging
from typing import Optional, Literal
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from ..config import config

logger = logging.getLogger(__name__)

# Map frontend model IDs to (provider, actual_model_name)
MODEL_MAPPING = {
    'gpt-4o-mini': ('openai', 'gpt-4o-mini'),
    'gpt-4o': ('openai', 'gpt-4o'),
    'claude-sonnet': ('anthropic', 'claude-sonnet-4-20250514'),
    'claude-opus': ('anthropic', 'claude-opus-4-20250514'),
}

# Fallback mapping when primary provider is unavailable
FALLBACK_MAPPING = {
    'gpt-4o-mini': 'claude-sonnet',
    'gpt-4o': 'claude-sonnet',
    'claude-sonnet': 'gpt-4o-mini',
    'claude-opus': 'gpt-4o',
}

# Type for model preference
ModelPreference = Literal['gpt-4o-mini', 'gpt-4o', 'claude-sonnet', 'claude-opus']


def get_fallback_model_id(model_id: str) -> Optional[str]:
    """Get the fallback model ID for a given model."""
    return FALLBACK_MAPPING.get(model_id)


def get_llm(
    model_preference: Optional[str] = None,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    allow_fallback: bool = True,
    **kwargs
):
    """
    Get LLM instance based on user preference.
    
    Args:
        model_preference: Frontend model ID ('gpt-4o-mini', 'gpt-4o', 'claude-sonnet', 'claude-opus')
        temperature: LLM temperature (default 0 for deterministic)
        max_tokens: Maximum tokens for response (optional)
        allow_fallback: If True, will fall back to alternate provider if primary is misconfigured
        **kwargs: Additional arguments passed to the LLM constructor
        
    Returns:
        ChatOpenAI or ChatAnthropic instance
    """
    model_id = model_preference or 'gpt-4o-mini'
    
    # Get provider and model name from mapping
    mapping = MODEL_MAPPING.get(model_id)
    if not mapping:
        logger.warning(f"Unknown model preference '{model_id}', falling back to gpt-4o-mini")
        mapping = MODEL_MAPPING['gpt-4o-mini']
        model_id = 'gpt-4o-mini'
    
    provider, model_name = mapping
    
    if provider == 'anthropic':
        if not config.anthropic_api_key:
            if allow_fallback:
                logger.warning("ANTHROPIC_API_KEY not set, falling back to OpenAI")
                return ChatOpenAI(
                    api_key=config.openai_api_key,
                    model='gpt-4o-mini',
                    temperature=temperature,
                    **({"max_tokens": max_tokens} if max_tokens else {}),
                    **kwargs
                )
            else:
                raise ValueError("ANTHROPIC_API_KEY not configured")
        
        logger.info(f"Using Anthropic model: {model_name}")
        return ChatAnthropic(
            api_key=config.anthropic_api_key,
            model=model_name,
            temperature=temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **kwargs
        )
    else:
        # OpenAI - check if API key is available
        if not config.openai_api_key and allow_fallback and config.anthropic_api_key:
            logger.warning("OPENAI_API_KEY not set, falling back to Anthropic")
            return ChatAnthropic(
                api_key=config.anthropic_api_key,
                model='claude-sonnet-4-20250514',
                temperature=temperature,
                **({"max_tokens": max_tokens} if max_tokens else {}),
                **kwargs
            )
        
        logger.info(f"Using OpenAI model: {model_name}")
        return ChatOpenAI(
            api_key=config.openai_api_key,
            model=model_name,
            temperature=temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **kwargs
        )


def get_fallback_llm(
    original_model_preference: Optional[str] = None,
    temperature: float = 0,
    max_tokens: Optional[int] = None,
    **kwargs
):
    """
    Get a fallback LLM when the primary provider fails (e.g., quota exceeded).
    
    This explicitly switches to the alternate provider.
    
    Args:
        original_model_preference: The model that failed
        temperature: LLM temperature
        max_tokens: Maximum tokens for response
        **kwargs: Additional arguments
        
    Returns:
        ChatOpenAI or ChatAnthropic instance from the alternate provider
        
    Raises:
        ValueError: If no fallback is available
    """
    original_id = original_model_preference or 'gpt-4o-mini'
    fallback_id = get_fallback_model_id(original_id)
    
    if not fallback_id:
        raise ValueError(f"No fallback available for model {original_id}")
    
    logger.info(f"Getting fallback LLM: {original_id} -> {fallback_id}")
    
    mapping = MODEL_MAPPING.get(fallback_id)
    if not mapping:
        raise ValueError(f"Unknown fallback model {fallback_id}")
    
    provider, model_name = mapping
    
    if provider == 'anthropic':
        if not config.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured for fallback")
        return ChatAnthropic(
            api_key=config.anthropic_api_key,
            model=model_name,
            temperature=temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **kwargs
        )
    else:
        if not config.openai_api_key:
            raise ValueError("OPENAI_API_KEY not configured for fallback")
        return ChatOpenAI(
            api_key=config.openai_api_key,
            model=model_name,
            temperature=temperature,
            **({"max_tokens": max_tokens} if max_tokens else {}),
            **kwargs
        )


def get_model_info(model_preference: Optional[str] = None) -> dict:
    """
    Get information about a model preference.
    
    Returns:
        dict with 'provider', 'model_name', and 'display_name'
    """
    model_id = model_preference or 'gpt-4o-mini'
    mapping = MODEL_MAPPING.get(model_id, MODEL_MAPPING['gpt-4o-mini'])
    provider, model_name = mapping
    
    display_names = {
        'gpt-4o-mini': 'GPT-4o mini',
        'gpt-4o': 'GPT-4o',
        'claude-sonnet': 'Claude Sonnet 4',
        'claude-opus': 'Claude Opus 4',
    }
    
    return {
        'provider': provider,
        'model_name': model_name,
        'display_name': display_names.get(model_id, model_id),
    }
