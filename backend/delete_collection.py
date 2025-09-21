import os
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def delete_collection():
    # Debug: Check if environment variables are loaded
    api_endpoint = os.environ.get("ASTRA_DB_VECTOR_API_ENDPOINT")
    token = os.environ.get("ASTRA_DB_VECTOR_APPLICATION_TOKEN")
    collection_name = os.environ.get("ASTRA_DB_VECTOR_COLLECTION_NAME")
    
    print(f"API Endpoint: {api_endpoint}")
    print(f"Token: {'*' * (len(token) - 8) + token[-8:] if token else 'NOT FOUND'}")
    print(f"Collection Name: {collection_name}")
    
    if not all([api_endpoint, token, collection_name]):
        print("Missing environment variables!")
        print("Make sure these are set in your .env file:")
        print("- ASTRA_DB_VECTOR_API_ENDPOINT")
        print("- ASTRA_DB_VECTOR_APPLICATION_TOKEN")
        print("- ASTRA_DB_VECTOR_COLLECTION_NAME")
        return False

    headers = {
        "Token": token,
        "Content-Type": "application/json"
    }

    # Use the correct AstraDB JSON API format
    delete_url = f"{api_endpoint}/api/json/v1"
    delete_payload = {
        "deleteCollection": {
            "name": collection_name
        }
    }
    
    print(f"\nDeleting collection: {collection_name}")
    print(f"URL: {delete_url}")
    print(f"Payload: {delete_payload}")
    
    # Use POST with deleteCollection command instead of DELETE
    response = requests.post(delete_url, json=delete_payload, headers=headers)

    if response.status_code == 200:
        result = response.json()
        print(f"Response: {result}")
        
        # Check if deletion was successful
        status = result.get("status", {})
        if status.get("ok") == 1:
            print(f"Collection {collection_name} deleted successfully")
            return True
        else:
            print(f"Delete failed: {result}")
            return False
    elif response.status_code == 404:
        print(f"Collection {collection_name} doesn't exist (already deleted)")
        return True
    else:
        print(f"Error: {response.status_code} - {response.text}")
        return False

if __name__ == "__main__":
    delete_collection()