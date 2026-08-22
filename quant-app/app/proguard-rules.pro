# Add project specific ProGuard rules here.
# Keep kotlinx.serialization generated serializers
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class com.quant.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.quant.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
