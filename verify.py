import os
import requests
from requests.auth import HTTPBasicAuth

# Credentials
API_ID = "6rkihujttvwxmqpleycoikhjz"
API_SECRET = "19c3s3fi5xex72nd5bnc6vm2wyza9ai0pvhxrvefw42457jp1k"

def verify_credentials():
    url = "https://www.datos.gov.co/api/users/current.json"
    
    print("Testing credentials against datos.gov.co...")
    try:
        response = requests.get(
            url,
            auth=HTTPBasicAuth(API_ID, API_SECRET),
            headers={"Accept": "application/json"}
        )
        print(f"Status Code: {response.status_code}")
        print(f"Response headers: {response.headers}")
        try:
            print("Response Body JSON:")
            print(response.json())
        except Exception:
            print("Response Body Text:")
            print(response.text[:1000])
            
        if response.status_code == 200:
            print("\nVerification SUCCESS: Credentials are valid!")
        else:
            print("\nVerification FAILED: Credentials might be invalid or there is another issue.")
    except Exception as e:
        print(f"Error making request: {e}")

if __name__ == "__main__":
    verify_credentials()
