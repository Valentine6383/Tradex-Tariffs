plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ru.k2monitor"
    compileSdk = 35
    defaultConfig {
        applicationId = "ru.k2monitor"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    // Ключ подписи создаётся на сборщике (см. .github/workflows/android.yml), в репо его нет
    signingConfigs {
        create("rel") {
            storeFile = file(System.getenv("K2_KEYSTORE") ?: "k2.keystore")
            storePassword = System.getenv("K2_KEY_PASS") ?: ""
            keyAlias = "k2"
            keyPassword = System.getenv("K2_KEY_PASS") ?: ""
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("rel")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
