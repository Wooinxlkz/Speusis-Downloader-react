use speusis_core::license::validate_key;

fn main() {
    let cases = [
        ("Speusis Sample User", "sample@speusis.local", "SPEUSIS-LIFE-28AF-2F490B84"),
        ("Speusis Sample User", "sample@speusis.local", "SPEUSIS-MTH-857C-E65B5F74"),
        ("Speusis Trial User", "trial@speusis.local", "SPEUSIS-TRIAL-A456-BDA4F371"),
        ("Someone Else", "other@example.com", "SPEUSIS-LIFE-28AF-2F490B84"), // should fail
    ];
    for (name, email, key) in cases {
        println!("{name} / {email} / {key} -> {:?}", validate_key(name, email, key));
    }
}
