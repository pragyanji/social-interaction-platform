from pathlib import Path
import ssl
import datetime

def generate_self_signed_cert():
    ssl_dir = Path("ssl")
    ssl_dir.mkdir(exist_ok=True)
    
    # Generate key
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes

    # Generate our key
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Write our key to disk
    with open(ssl_dir / "server.key", "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    # Generate a certificate
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, u"192.168.1.6"),
    ])
    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.utcnow()
    ).not_valid_after(
        datetime.datetime.utcnow() + datetime.timedelta(days=365)
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName("localhost"),
            x509.DNSName("192.168.1.6"),
        ]),
        critical=False,
    ).sign(key, hashes.SHA256())

    # Write our certificate out to disk.
    with open(ssl_dir / "server.crt", "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print("Certificate generated successfully!")

if __name__ == "__main__":
    generate_self_signed_cert()