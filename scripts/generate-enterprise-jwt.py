#!/usr/bin/env python3
"""
Novatio Enterprise Canton JWT & JWKS Generator
==============================================
Generates production-grade RS256 / ES256 cryptographic key pairs, Canton-compliant
JSON Web Key Sets (JWKS), and signed enterprise bearer tokens for institutional
participant authentication (Auth0 / Okta / Azure AD / PingIdentity compatibility).

Supports:
1. Canton User Management Claims (RFC 7519 standard `sub`, `aud`, `iss`)
2. Canton Legacy/Custom Claims (`https://daml.com/ledger-api` with `actAs`, `readAs`)
"""

import argparse
import base64
import json
import os
import sys
import time
from typing import Dict, Any, Tuple

try:
    from cryptography.hazmat.primitives.asymmetric import rsa, ec
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.backends import default_backend
except ImportError:
    sys.stderr.write("Error: 'cryptography' library is required. Install via: pip install cryptography\n")
    sys.exit(1)


def int_to_base64url(val: int) -> str:
    """Converts a positive integer to a URL-safe Base64 encoded byte string without padding."""
    hex_str = f"{val:x}"
    if len(hex_str) % 2 == 1:
        hex_str = "0" + hex_str
    raw_bytes = bytes.fromhex(hex_str)
    return base64.urlsafe_b64encode(raw_bytes).decode("utf-8").rstrip("=")


def bytes_to_base64url(raw_bytes: bytes) -> str:
    """Encodes bytes to URL-safe Base64 without '=' padding."""
    return base64.urlsafe_b64encode(raw_bytes).decode("utf-8").rstrip("=")


def generate_rsa_keypair(key_size: int = 2048) -> Tuple[rsa.RSAPrivateKey, str]:
    """Generates an RSA private key and a deterministic Key ID."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=key_size,
        backend=default_backend()
    )
    kid = f"novatio-rsa-{int(time.time())}"
    return private_key, kid


def generate_ec_keypair() -> Tuple[ec.EllipticCurvePrivateKey, str]:
    """Generates an ECDSA P-256 private key and a Key ID."""
    private_key = ec.generate_private_key(
        ec.SECP256R1(),
        backend=default_backend()
    )
    kid = f"novatio-ec-{int(time.time())}"
    return private_key, kid


def rsa_to_jwk(private_key: rsa.RSAPrivateKey, kid: str) -> Dict[str, Any]:
    """Extracts public numbers to RFC 7517 JWK format."""
    public_numbers = private_key.public_key().public_numbers()
    return {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": kid,
        "n": int_to_base64url(public_numbers.n),
        "e": int_to_base64url(public_numbers.e)
    }


def ec_to_jwk(private_key: ec.EllipticCurvePrivateKey, kid: str) -> Dict[str, Any]:
    """Extracts EC public numbers to RFC 7517 JWK format."""
    public_numbers = private_key.public_key().public_numbers()
    return {
        "kty": "EC",
        "crv": "P-256",
        "use": "sig",
        "alg": "ES256",
        "kid": kid,
        "x": int_to_base64url(public_numbers.x),
        "y": int_to_base64url(public_numbers.y)
    }


def sign_jwt(
    header: Dict[str, Any],
    payload: Dict[str, Any],
    private_key: Any,
    alg: str
) -> str:
    """Constructs and signs a JWT according to RFC 7515."""
    encoded_header = bytes_to_base64url(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    encoded_payload = bytes_to_base64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")

    if alg == "RS256":
        signature = private_key.sign(
            signing_input,
            padding.PKCS1v15(),
            hashes.SHA256()
        )
    elif alg == "ES256":
        signature = private_key.sign(
            signing_input,
            ec.ECDSA(hashes.SHA256())
        )
    else:
        raise ValueError(f"Unsupported algorithm: {alg}")

    encoded_signature = bytes_to_base64url(signature)
    return f"{encoded_header}.{encoded_payload}.{encoded_signature}"


def build_canton_token(
    user_id: str,
    party_id: str,
    role: str,
    private_key: Any,
    kid: str,
    alg: str = "RS256",
    issuer: str = "https://auth.novatio.institutional.finance",
    audience: str = "https://daml.com/jwt/aud/canton",
    ledger_id: str = "trade_finance_synchronizer",
    expiry_hours: int = 24
) -> str:
    """Builds an enterprise Canton bearer token with dual claims."""
    now = int(time.time())
    header = {
        "typ": "JWT",
        "alg": alg,
        "kid": kid
    }

    # Custom readAs / actAs based on participant role
    if role == "buyer":
        act_as = [party_id]
        read_as = [party_id]
    elif role == "supplier":
        act_as = [party_id]
        read_as = [party_id]
    elif role == "factorer":
        act_as = [party_id]
        read_as = [party_id]
    elif role == "auditor":
        act_as = [party_id]
        read_as = [party_id]  # Observes transactions across participating domains
    else:
        act_as = [party_id]
        read_as = [party_id]

    payload = {
        "iss": issuer,
        "sub": user_id,
        "aud": audience,
        "exp": now + (expiry_hours * 3600),
        "iat": now,
        "scope": "daml_ledger_api",
        # Canton 2.x & 3.x Custom Claims
        "https://daml.com/ledger-api": {
            "ledgerId": ledger_id,
            "applicationId": "novatio-enterprise-app",
            "actAs": act_as,
            "readAs": read_as,
            "admin": (role == "auditor")
        }
    }

    return sign_jwt(header, payload, private_key, alg)


def main():
    parser = argparse.ArgumentParser(description="Novatio Enterprise Canton JWT & JWKS Generator")
    parser.add_argument("--alg", choices=["RS256", "ES256"], default="RS256", help="Asymmetric algorithm (default: RS256)")
    parser.add_argument("--role", choices=["buyer", "supplier", "factorer", "auditor", "all"], default="all", help="Target participant role")
    parser.add_argument("--out-dir", default="./enterprise-auth", help="Output directory for keys, JWKS, and tokens")
    parser.add_argument("--ledger-id", default="trade_finance_synchronizer", help="Target Canton synchronizer domain / ledger ID")
    parser.add_argument("--print-tokens", action="store_true", help="Print generated tokens to stdout")

    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    print(f"[*] Generating {args.alg} cryptographic keypair...")
    if args.alg == "RS256":
        private_key, kid = generate_rsa_keypair()
        jwk = rsa_to_jwk(private_key, kid)
        pem_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )
    else:
        private_key, kid = generate_ec_keypair()
        jwk = ec_to_jwk(private_key, kid)
        pem_bytes = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        )

    jwks = {"keys": [jwk]}

    # Write Private Key and JWKS
    key_path = os.path.join(args.out_dir, f"private_key_{args.alg.lower()}.pem")
    jwks_path = os.path.join(args.out_dir, "jwks.json")

    with open(key_path, "wb") as f:
        f.write(pem_bytes)
    with open(jwks_path, "w", encoding="utf-8") as f:
        json.dump(jwks, f, indent=2)

    print(f"[+] Private Key written to: {key_path}")
    print(f"[+] JWKS written to:        {jwks_path}")

    # Participant specs
    roles_to_generate = (
        ["buyer", "supplier", "factorer", "auditor"]
        if args.role == "all"
        else [args.role]
    )

    tokens_manifest = {}

    for r in roles_to_generate:
        user_id = f"{r}_user"
        party_id = f"{r.capitalize()}::institutional_cluster_id"
        token = build_canton_token(
            user_id=user_id,
            party_id=party_id,
            role=r,
            private_key=private_key,
            kid=kid,
            alg=args.alg,
            ledger_id=args.ledger_id
        )
        tokens_manifest[r] = {
            "userId": user_id,
            "partyId": party_id,
            "role": r,
            "token": token
        }
        token_file = os.path.join(args.out_dir, f"token_{r}.jwt")
        with open(token_file, "w", encoding="utf-8") as f:
            f.write(token)

        print(f"[+] Generated token for [{r.upper()}] -> {token_file}")
        if args.print_tokens:
            print(f"    Token: {token}\n")

    manifest_path = os.path.join(args.out_dir, "tokens_manifest.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(tokens_manifest, f, indent=2)

    print(f"[+] Tokens manifest written to: {manifest_path}")
    print("[*] Completed successfully.")


if __name__ == "__main__":
    main()
